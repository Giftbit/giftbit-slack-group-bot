import "babel-polyfill";
import {
    CompleteRegistrationVerificationTask, CreateRegistrationVerificationTask, GroupAdditionRequestTask, ListGroupsTask,
    ShowUserAccountsTask,
    Task
} from "./Task";
import * as aws from "aws-sdk";
import * as awslambda from "aws-lambda";
import * as uuid from "node-uuid";
import {sendResponse} from "./Responder";
import {ListGroupsResponse, ListGroupsRequest, GetUserIdRequest, GetUserIdResponse} from "../iamReader/IamReaderEvent";
import {ListObjectsRequest} from "aws-sdk/clients/s3";
import {account} from "aws-sdk/clients/sns";

const lambda = new aws.Lambda();
const s3 = new aws.S3();
const debug = true;

const GROUP_BOT_PROJECT = process.env.GROUP_BOT_PROJECT;
const REGION = process.env.REGION;
const DATA_STORE_BUCKET = process.env.DATA_STORE_BUCKET;

type TaskHandler = (task: Task) => Promise<void>;

const handlers: { [ key: string]: TaskHandler} = {
    listGroups: listGroupsHandler,
    createRegistrationVerification: createRegistrationVerificationHandler,
    completeRegistrationVerification: completeRegistrationVerificationHandler,
    showUserAccounts: showUserAccountsHandler,
    groupAdditionRequest: groupAdditionRequestHandler
};

export function handler (task: Task, ctx: awslambda.Context, callback: awslambda.Callback): void {
    debug && console.log("event", JSON.stringify(task, null, 2));
    handlerAsync(task, ctx)
        .then(() => {
            callback(null, {});
        }, err => {
            console.error(err);
            callback(err);
        });
}

async function handlerAsync(task: Task, context: awslambda.Context): Promise<void> {
    if (!(task.command in handlers)) {
        throw new Error(`Task does not exist with command: ${task.command}`);
    }

    return await handlers[task.command](task);
}

async function listGroupsHandler(task: ListGroupsTask) {
    const accountGroupsRequests= Object.keys(task.accounts).map(accountName => {
        const accountId = task.accounts[accountName];

        const listGroupsRequest: ListGroupsRequest = {
            command: "listGroups"
        };

        const lambdaPromise =  lambda.invoke({
            FunctionName: `arn:aws:lambda:${REGION}:${accountId}:function:${GROUP_BOT_PROJECT}-IamReader`,
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
        let lambdaResponse = await accountGroupsRequest.lambdaPromise;

        if (lambdaResponse.FunctionError) {
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
        username: username
    };

    const lambdaResponse = await lambda.invoke({
        FunctionName: `arn:aws:lambda:${REGION}:${accountId}:function:${GROUP_BOT_PROJECT}-IamReader`,
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
            let params: aws.S3.Types.PutObjectRequest = {
                Body: `${verificationUuid}\n`,
                Bucket: DATA_STORE_BUCKET,
                Key: objectKey
            };
            await s3.putObject(params).promise()

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
        const verificationKey = verificationObject.Key
        const getObjectRequest = {
            Bucket: DATA_STORE_BUCKET,
            Key: verificationKey
        };
        const getObjectResponse = await s3.getObject(getObjectRequest).promise();
        const verificationValue = getObjectResponse.Body.toString();

        if (verificationValue.trim() === token) {
            const verificationParts = verificationKey.split("/");
            const accountId = verificationParts[1];
            const username = verificationParts[3];
            const slackUserId = verificationParts[4];
            const putObjectRequest: aws.S3.Types.PutObjectRequest = {
                Body: username,
                Bucket: DATA_STORE_BUCKET,
                Key: `users/${slackUserId}/${accountId}`
            };
            await s3.putObject(putObjectRequest).promise();

            let responseLines = [
                `IAM Account ${username} verified.`
            ];
            await sendResponse({
                text: responseLines.join("\n")
            }, task.responseUrl);

            const deleteObjectRequest: aws.S3.Types.DeleteObjectRequest = {
                Bucket: DATA_STORE_BUCKET,
                Key: verificationKey
            };
            await s3.deleteObject(deleteObjectRequest).promise();

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

        const getObjectRequest: aws.S3.Types.GetObjectRequest = {
            Bucket: DATA_STORE_BUCKET,
            Key: objectKey
        };
        const getObjectResponse = await s3.getObject(getObjectRequest).promise();
        const username = getObjectResponse.Body.toString().trim();

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
    const groupName = task.groupName;

    let getObjectResponse = null;
    try {
        const getObjectRequest: aws.S3.Types.GetObjectRequest = {
            Bucket: DATA_STORE_BUCKET,
            Key: `users/${slackUserId}/${accountId}`
        };
        getObjectResponse = await s3.getObject(getObjectRequest).promise();
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

    const username = getObjectResponse.Body.toString().trim();

    const listGroupsRequest: ListGroupsRequest = {
        command: "listGroups"
    };

    const lambdaResponse = await lambda.invoke({
        FunctionName: `arn:aws:lambda:${REGION}:${accountId}:function:${GROUP_BOT_PROJECT}-IamReader`,
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

    const requestUuid = uuid.v4();
    const groupAdditionRequest = {
        accountId: accountId,
        userName: username,
        groupName: groupName
    };
    const putObjectRequest: aws.S3.Types.PutObjectRequest = {
        Body: JSON.stringify(groupAdditionRequest),
        Bucket: DATA_STORE_BUCKET,
        Key: `requests/${requestUuid}`
    };
    await s3.putObject(putObjectRequest).promise();

    const responseLines = [
        `<@${slackUserId}> has requested to be added to the group *${groupName}* in the *${accountName}* account`,
        "To approve this request, run the command",
        `\`${task.triggerWord} approve ${requestUuid}\``
    ];
    await sendResponse({
        text: responseLines.join("\n"),
        response_type: "in_channel"
    }, task.responseUrl);
}
