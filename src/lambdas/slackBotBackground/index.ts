import "babel-polyfill";
import {
    CompleteRegistrationVerificationTask, CreateRegistrationVerificationTask, GroupAdditionApprovalTask,
    GroupAdditionRequestTask, ListGroupsTask,
    ShowUserAccountsTask,
    Task
} from "./Task";
import * as aws from "aws-sdk";
import * as awslambda from "aws-lambda";
import * as uuid from "node-uuid";
import {sendResponse} from "./Responder";
import {
    ListGroupsResponse, ListGroupsRequest, GetUserIdRequest, GetUserIdResponse,
    AddUserToGroupResponse, AddUserToGroupRequest, RemoveUserFromGroupResponse, RemoveUserFromGroupRequest
} from "../iamAgent/IamAgentEvent";
import {ListObjectsRequest} from "aws-sdk/clients/s3";
import {GroupAdditionApproval, GroupAdditionRequest, Username} from "./Data";
import {ScheduledEvent} from "../../common/lambda-events";
import {S3DataStore} from "./S3DataStore"

const lambda = new aws.Lambda();
const s3 = new aws.S3();
const debug = true;

const GROUP_BOT_PROJECT = process.env.GROUP_BOT_PROJECT;
const REGION = process.env.REGION;
const DATA_STORE_BUCKET = process.env.DATA_STORE_BUCKET;

const dataStore = new S3DataStore(DATA_STORE_BUCKET);

const ALLOW_SELF_APPROVAL = process.env.ALLOW_SELF_APPROVAL == "true";

type TaskHandler = (task: Task) => Promise<void>;

const handlers: { [ key: string]: TaskHandler} = {
    listGroups: listGroupsHandler,
    createRegistrationVerification: createRegistrationVerificationHandler,
    completeRegistrationVerification: completeRegistrationVerificationHandler,
    showUserAccounts: showUserAccountsHandler,
    groupAdditionRequest: groupAdditionRequestHandler,
    groupAdditionApproval: groupAdditionApprovalHandler
};

export function handler (event: Task | ScheduledEvent, ctx: awslambda.Context, callback: awslambda.Callback): void {
    debug && console.log("event", JSON.stringify(event, null, 2));
    handlerAsync(event, ctx)
        .then(() => {
            callback(null, {});
        }, err => {
            console.error(err);
            callback(err);
        });
}

async function handlerAsync(event: ScheduledEvent | Task, context: awslambda.Context): Promise<void> {
    if ((<ScheduledEvent>event).source === "aws.events" && (<ScheduledEvent>event)["detail-type"] === "Scheduled Event") {
        return await resolveExpirations();
    }

    if (!((<Task>event).command in handlers)) {
        throw new Error(`Task does not exist with command: ${(<Task>event).command}`);
    }

    return await handlers[(<Task>event).command]((<Task>event));
}

async function listGroupsHandler(task: ListGroupsTask) {
    const accountGroupsRequests= Object.keys(task.accounts).map(accountName => {
        const accountId = task.accounts[accountName];

        const listGroupsRequest: ListGroupsRequest = {
            command: "listGroups"
        };

        const lambdaPromise =  lambda.invoke({
            FunctionName: `arn:aws:lambda:${REGION}:${accountId}:function:${GROUP_BOT_PROJECT}-IamAgent`,
            InvocationType: "RequestResponse",
            Payload: JSON.stringify(listGroupsRequest)
        }).promise();

        return {
            accountName: accountName,
            lambdaPromise: lambdaPromise
        }
    });

    let responseLines: string[] = [];
    for (let accountGroupsRequest of accountGroupsRequests) {

        let lambdaResponse = null;
        try {
            lambdaResponse = await accountGroupsRequest.lambdaPromise;
        } catch (err) {
            console.error(`An Exception occurred in querying the groups from ${accountGroupsRequest.accountName}`,err);
        }

        if (!lambdaResponse) {
            console.log(`Lambda response for ${accountGroupsRequest.accountName} was not set`);
        }
        else if (lambdaResponse.FunctionError) {
            console.log(`An error occurred fetching the groups from ${accountGroupsRequest.accountName}`,lambdaResponse.FunctionError);
        } else {
            const getGroupsResponse: ListGroupsResponse = JSON.parse(lambdaResponse.Payload.toString());
            debug && console.log("groups", getGroupsResponse);

            if (responseLines.length > 0) {
                responseLines.push("");
            }
            if (getGroupsResponse.groups.length > 0) {
                responseLines.push(`*${accountGroupsRequest.accountName}*:`);
                const groupNames = getGroupsResponse.groups.map(groupName => `- ${groupName}`)
                responseLines.push(...groupNames);
            }
        }
    }

    if (responseLines.length < 1) {
        responseLines.push("No requestable groups found.");
    }

    const response = {
        text: responseLines.join("\n")
    };

    await sendResponse(response, task.responseUrl);
}

async function createRegistrationVerificationHandler(task: CreateRegistrationVerificationTask) {
    const accountId = task.accountId;
    const username = task.username;
    const slackUserId = task.slackUserId;
    const triggerWord = task.triggerWord;
    const getUserIdRequest: GetUserIdRequest = {
        command: "getUserId",
        userName: username
    };

    const lambdaResponse = await lambda.invoke({
        FunctionName: `arn:aws:lambda:${REGION}:${accountId}:function:${GROUP_BOT_PROJECT}-IamAgent`,
        InvocationType: "RequestResponse",
        Payload: JSON.stringify(getUserIdRequest)
    }).promise();

    let response = {};
    if (lambdaResponse.FunctionError) {
        console.error(`Error looking up ${username} for account ${accountId}`,lambdaResponse.FunctionError);

        response = {
            text: `An error occurred looking up the user: ${username}.\nPlease ensure you provided the correct username for the account`
        };
    } else {
        const getUserIdResponse: GetUserIdResponse = JSON.parse(lambdaResponse.Payload.toString());
        debug && console.log("getUserIdResponse", getUserIdResponse);

        const userId = getUserIdResponse.userId;
        if (!userId) {
            console.log(`User ${username} returned no userId`);

            response = {
                text: `An error occurred looking up the user: ${username}.\nPlease ensure you provided the correct username for the account`
            };
        } else {
            const verificationUuid = uuid.v4();
            const objectKey = `verifications/${accountId}/${userId}/${username}/${slackUserId}`;
            await dataStore.putObject(`${verificationUuid}\n`, objectKey);

            const responseLines = [
                `To verify your ${username} with your user`,
                "please run the following command in your terminal",
                `\`aws s3 cp s3://${DATA_STORE_BUCKET}/${objectKey} -\``,
                "This will give you the verification code",
                "Next run the command:",
                `\`${triggerWord} verify <verification_code>\``,
                "to complete the verification process."
            ];

            response = {
                text: responseLines.join("\n")
            }
        }
    }

    await sendResponse(response, task.responseUrl);
}

async function completeRegistrationVerificationHandler(task: CompleteRegistrationVerificationTask) {
    const slackUserId = task.slackUserId;
    const token = task.token;

    const listObjectsRequest: aws.S3.Types.ListObjectsRequest = {
        Bucket: DATA_STORE_BUCKET,
        Prefix: "verifications/"
    };
    const listObjectsResponse = await s3.listObjects(listObjectsRequest).promise();
    const verificationObjects = listObjectsResponse.Contents;
    const verificationObject = verificationObjects.find(verificationObject => verificationObject.Key.endsWith(`/${slackUserId}`));

    if (verificationObject) {
        const verificationKey = verificationObject.Key;
        const verificationValue = await dataStore.getObject(verificationKey);

        if (verificationValue.trim() === token) {
            const verificationParts = verificationKey.split("/");
            const accountId = verificationParts[1];
            const username: Username = verificationParts[3];
            const slackUserId = verificationParts[4];
            await dataStore.putObject(username, `users/${slackUserId}/${accountId}`);

            let responseLines = [
                `IAM Account ${username} verified.`
            ];
            await sendResponse({
                text: responseLines.join("\n")
            }, task.responseUrl);

            await dataStore.deleteObject(verificationKey);

            return;
        }
    }

    let responseLines = [
        `Verification failed.`
    ];
    await sendResponse({
        text: responseLines.join("\n")
    }, task.responseUrl);
}

async function showUserAccountsHandler(task: ShowUserAccountsTask) {
    const accounts = task.accounts;
    const slackUserId = task.slackUserId;

    const accountIdNameMap = {};
    for (let accountName of Object.keys(accounts)) {
        const accountId = accounts[accountName];
        accountIdNameMap[accountId] = accountName;
    }

    const listObjectsRequest: ListObjectsRequest = {
        Bucket: DATA_STORE_BUCKET,
        Prefix: `users/${slackUserId}/`
    };
    const listObjectsResponse = await s3.listObjects(listObjectsRequest).promise();
    const userAccountObjects = listObjectsResponse.Contents;

    let responseLines = [];
    for (let userAccountObject of userAccountObjects) {
        const objectKey = userAccountObject.Key;
        const objectKeyPieces = objectKey.split("/");
        const accountId = objectKeyPieces[2];

        const username: Username = (await dataStore.getObject(objectKey)).trim();

        const accountName = accountIdNameMap[accountId];
        responseLines.push(`*${accountName}*: ${username}`)
    }

    await sendResponse({
        text: responseLines.join("\n")
    }, task.responseUrl);
}

async function groupAdditionRequestHandler(task: GroupAdditionRequestTask) {
    const accountId = task.accountId;
    const accountName = task.accountName;
    const slackUserId = task.slackUserId;
    const slackUserName = task.slackUserName;
    const groupName = task.groupName;
    const validForSeconds = task.validForSeconds;
    const membershipDurationMinutes = task.membershipDurationMinutes;

    let username = null;
    try {
        username = (await dataStore.getObject(`users/${slackUserId}/${accountId}`)).trim();
    } catch (err) {
        const responseLines = [
            "We were unable to complete your request",
            "Are you sure your account has been registered?",
            "",
            "You can register your account with",
            `\`${task.triggerWord} register <username> <account>\``
        ];
        await sendResponse({
            text: responseLines.join("\n")
        }, task.responseUrl);
        return
    }

    const listGroupsRequest: ListGroupsRequest = {
        command: "listGroups"
    };
    const lambdaResponse = await lambda.invoke({
        FunctionName: `arn:aws:lambda:${REGION}:${accountId}:function:${GROUP_BOT_PROJECT}-IamAgent`,
        InvocationType: "RequestResponse",
        Payload: JSON.stringify(listGroupsRequest)
    }).promise();
    const getGroupsResponse: ListGroupsResponse = JSON.parse(lambdaResponse.Payload.toString());

    const groups = getGroupsResponse.groups;

    if (groups.indexOf(groupName) < 0) {
        const responseLines = [
            `Group *${groupName}* was not recognized`,
            "",
            "You can se a full of available groups with",
            `\`${task.triggerWord} list\``
        ];
        await sendResponse({
            text: responseLines.join("\n")
        }, task.responseUrl);
        return
    }

    const expiryTime = new Date().getTime() + validForSeconds * 1000;
    const requestUuid = uuid.v4();
    const groupAdditionRequest: GroupAdditionRequest = {
        accountId: accountId,
        accountName: accountName,
        requesterSlackName: slackUserName,
        requesterSlackId: slackUserId,
        userName: username,
        groupName: groupName,
        membershipDurationMinutes: membershipDurationMinutes
    };
    await dataStore.putObject(JSON.stringify(groupAdditionRequest),`requests/${requestUuid}-${expiryTime}`);

    const epoch = Math.floor(expiryTime / 1000);
    const responseLines = [
        `<@${slackUserId}> has requested to be added to the group *${groupName}* in the *${accountName}* account for *${membershipDurationMinutes}* minutes.`,
        "To approve this request, run the command",
        `\`${task.triggerWord} approve ${requestUuid}\``,
        "",
        `This request will expire <!date^${epoch}^on {date} at {time}|at ${new Date(expiryTime).toISOString()}>`
    ];
    await sendResponse({
        text: responseLines.join("\n"),
        response_type: "in_channel"
    }, task.responseUrl);
}

async function groupAdditionApprovalHandler(task: GroupAdditionApprovalTask) {
    const requestId = task.requestId;
    const slackUserName = task.slackUserName;
    const slackUserId = task.slackUserId;

    const currentTime = new Date().getTime();
    debug && console.log("currentTime", currentTime);

    const listObjectsRequest: aws.S3.Types.ListObjectsRequest = {
        Bucket: DATA_STORE_BUCKET,
        Prefix: `requests/${requestId}-`
    };
    const listObjectsResponse = await s3.listObjects(listObjectsRequest).promise();
    debug && console.log("listObjectsResponse", listObjectsResponse);
    const requestObject = listObjectsResponse.Contents.find((request) => {
        debug && console.log("request",request);
        const expiry = parseInt(request.Key.replace(`requests/${requestId}-`,""));
        debug && console.log("expiry",expiry);
        return currentTime <= expiry;
    });

    debug && console.log("requestObject", requestObject);

    if (!requestObject) {
        const responseLines = [
            `Unable to find request ${requestId}. Either the ID is incorrect, or it expired.`,
            "",
            "Please check your request ID and try again, or have the requester repeat their request."
        ];
        await sendResponse({
            text: responseLines.join("\n")
        }, task.responseUrl);
        return
    }

    const request: GroupAdditionRequest = JSON.parse(await dataStore.getObject(requestObject.Key));

    const expiryTime = new Date().getTime() + request.membershipDurationMinutes * 60 * 1000;

    if (! ALLOW_SELF_APPROVAL) {
        if (request.requesterSlackId === slackUserId) {
            const responseLines = [
                "You are unable to approve your own requests. Please ask for approval from one of the approvers."
            ];
            await sendResponse({
                text: responseLines.join("\n")
            }, task.responseUrl);
        }
    }

    try {
        await dataStore.putObject(JSON.stringify(request), `removals/${requestId}-${expiryTime}`);

        const addUserToGroupRequest: AddUserToGroupRequest = {
            command: "addUserToGroup",
            userName: request.userName,
            groupName: request.groupName
        };
        const lambdaResponse = await lambda.invoke({
            FunctionName: `arn:aws:lambda:${REGION}:${request.accountId}:function:${GROUP_BOT_PROJECT}-IamAgent`,
            InvocationType: "RequestResponse",
            Payload: JSON.stringify(addUserToGroupRequest)
        }).promise();
        const addUserToGroupResponse: AddUserToGroupResponse = JSON.parse(lambdaResponse.Payload.toString());

        if (! addUserToGroupResponse.userAddSuccessful) {
            const responseLines = [
                `An error occurred attempting to add *${request.userName}* to the group *${request.groupName}*.`,
                "",
                "Check with your AWS Administrator, or the logs of your Groupbot IAM Agent for further details."
            ];
            await sendResponse({
                text: responseLines.join("\n")
            }, task.responseUrl);
            return
        }

        const approval: GroupAdditionApproval = Object.assign({
            approverSlackName: slackUserName,
            approverSlackId: slackUserId
        }, request);
        await dataStore.putObject(JSON.stringify(approval), requestObject.Key.replace("requests","approvals"));

        await dataStore.deleteObject(requestObject.Key);
    } catch (err) {
        console.error("An error occurred in setting a deletion object", err);

        const responseLines = [
            `An error occurred attempting to add *${request.userName}* to the group *${request.groupName}*.`,
            "",
            "Check with your AWS Administrator, or the logs of your Groupbot IAM Agent for further details."
        ];
        await sendResponse({
            text: responseLines.join("\n")
        }, task.responseUrl);

        return
    }

    const epoch = Math.floor(expiryTime / 1000);
    const responseLines = [
        `<@${slackUserId}> has approved <@${request.requesterSlackId}>'s has requested to be added to the group *${request.groupName}* in the *${request.accountName}* account.`,
        `This permission will expire <!date^${epoch}^on {date} at {time}|at ${new Date(expiryTime).toISOString()}>`
    ];
    await sendResponse({
        text: responseLines.join("\n"),
        response_type: "in_channel"
    }, task.responseUrl);
}

async function resolveExpirations() {
    await resolveExpiredGroupAdditions();
    await resolveExpiredRequests();
}

async function resolveExpiredGroupAdditions() {
    const listObjectsRequest: aws.S3.Types.ListObjectsRequest = {
        Bucket: DATA_STORE_BUCKET,
        Prefix: "removals/"
    };
    const listObjectsResponse = await s3.listObjects(listObjectsRequest).promise();
    const removalObjects = listObjectsResponse.Contents;
    debug && console.log("removalObjects", removalObjects);

    const nowTime = new Date().getTime();
    const expiredRemovalObjects = removalObjects.filter((removalObject) => {
        const expiration = parseInt(removalObject.Key.substr(removalObject.Key.lastIndexOf("-") + 1));
        debug && console.log("expiration", expiration);
        return expiration <= nowTime;
    });

    for (let expiredRemovalObject of expiredRemovalObjects) {
        const removal: GroupAdditionRequest = JSON.parse(await dataStore.getObject(expiredRemovalObject.Key));

        try {
            const removeUserFromGroupRequest: RemoveUserFromGroupRequest = {
                command: "removeUserFromGroup",
                userName: removal.userName,
                groupName: removal.groupName
            };
            const lambdaResponse = await lambda.invoke({
                FunctionName: `arn:aws:lambda:${REGION}:${removal.accountId}:function:${GROUP_BOT_PROJECT}-IamAgent`,
                InvocationType: "RequestResponse",
                Payload: JSON.stringify(removeUserFromGroupRequest)
            }).promise();
            const removeUserFromGroupResponse: RemoveUserFromGroupResponse = JSON.parse(lambdaResponse.Payload.toString());

            if (removeUserFromGroupResponse.userRemovalSuccessful) {
                await dataStore.deleteObject(expiredRemovalObject.Key);
            }
        } catch (err) {
            console.error("An Error occurred processing a removal",removal,err);
        }
    }
}

async function resolveExpiredRequests() {
    const listObjectsRequest: aws.S3.Types.ListObjectsRequest = {
        Bucket: DATA_STORE_BUCKET,
        Prefix: "requests/"
    };
    const listObjectsResponse = await s3.listObjects(listObjectsRequest).promise();
    const requestObjects = listObjectsResponse.Contents;
    debug && console.log("requestObjects", requestObjects);

    const nowTime = new Date().getTime();
    const expiredRequestObjects = requestObjects.filter((requestObject) => {
        const expiration = parseInt(requestObject.Key.substr(requestObject.Key.lastIndexOf("-") + 1));
        debug && console.log("expiration", expiration);
        return expiration <= nowTime;
    });

    for (let expiredRequestObject of expiredRequestObjects) {
        try {
            await dataStore.copyObject(expiredRequestObject.Key, expiredRequestObject.Key.replace("requests","expired_requests"));

            await dataStore.deleteObject(expiredRequestObject.Key);
        } catch (err) {
            console.error("An error occurred cleaning up expired request",expiredRequestObject,err);
        }
    }
}
