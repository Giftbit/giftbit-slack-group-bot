import "babel-polyfill";
import * as awslambda from "aws-lambda";
import * as aws from "aws-sdk";
import * as uuid from "node-uuid";
import {Message} from "./Message";
import {
    ListGroupsTask, CreateRegistrationVerificationTask,
    CompleteRegistrationVerificationTask, ShowUserAccountsTask,
} from "../slackBotBackground/Task";

const debug = true;

const ACCOUNT_ID =  process.env.ACCOUNT_ID;
const ACCOUNTS: { [accountName: string]: string } = JSON.parse(process.env.ACCOUNTS);
const TOKEN = process.env.TOKEN;
const APPROVERS: string = process.env.APPROVERS;
const SLACK_BOT_BACKGROUND_TASK_LAMBDA_ARN = process.env.SLACK_BOT_BACKGROUND_TASK_LAMBDA_ARN;
const DATA_STORE_BUCKET = process.env.DATA_STORE_BUCKET;

const usersTableName = "giftbit-slack-bot-users";
const requestTableName = "giftbit-slack-bot-requests";
const membershipDurationMinutes = 60;

type ActionHandler = (words: string[], message: Message) => Promise<any>;

let dynamo = new aws.DynamoDB();
let lambda = new aws.Lambda();

const handlers: { [ key: string]: ActionHandler} = {
    help: helpHandler,
    list: listHandler,
    register: registerHandler,
    verify: verifyHandler,
    whoami: whoamiHandler,
    request: requestHandler,
    approve: approveHandler
};

const actionDescriptions:  { [key: string]: string } = {
    "list": "Lists the groups that can be requested",
    "register <username> <account>": "Registers your AWS Username for an account so we can add it to groups",
    "verify <token>": "Verifies the AWS Account you registered",
    "whoami": "Displays your registered AWS IAM username",
    "request <group_name>": "Creates a request to be added to a group temporarily",
    "approve <request_id>": "Approves a request to join a group"
};

export function handler (message: Message, ctx: awslambda.Context, callback: awslambda.Callback): void {
    debug && console.log("event", JSON.stringify(message, null, 2));
    handleMessage(message, ctx)
        .then(res => {
            callback(null, res);
        }, err => {
            console.error(err);
            callback(err);
        });
}

async function handleMessage(message: Message, ctx: awslambda.Context): Promise<any> {
    if (message.token !== TOKEN) {
        return {
            code: "NotFound",
            message: "The requested resource was not found"
        };
    }

    let rawWords = message.text.replace(/\s+/g, " ");
    console.log("rawWords:", rawWords);
    let words = rawWords.split(" ");
    let triggerWord = message.command;

    debug && console.log("Words:", words, "Trigger Word:", triggerWord);

    const action = words.shift();

    if (!action) {
        return {
            text: `How can I help you? If you're not sure what to do, try \`${message.command} help\``
        };
    }

    debug && console.log("Requested handler: ", action);
    if (!(action in handlers)) {
        return {
            text: `Sorry, I don't understand \`${action}\`. Try \`${message.command} help\` to find out what I do know.`
        };
    }

    debug && console.log("Delegating to:", action, "Words: ", words, "Message: ", message);
    try {
        return handlers[action](words, message);
    }
    catch (err) {
        return {
            text: "An unexpected error occurred: " + err.message
        };
    }
}

async function helpHandler(words: string[], message: Message): Promise<any> {
    let responseLines: string[] = [];

    if (Object.keys(actionDescriptions).length) {
        responseLines.push("Here's some things you can do:");
    }

    for (let action in actionDescriptions) {
        responseLines.push(`\`${message.command} ${action}\`: ${actionDescriptions[action]}`);
    }

    return {
        text: responseLines.join("\n")
    };
}

async function listHandler(words: string[], message: Message): Promise<any> {
    const listGroupsTask: ListGroupsTask = {
        command: "listGroups",
        accounts: ACCOUNTS,
        responseUrl: message.response_url
    };

    lambda.invoke({
        FunctionName: SLACK_BOT_BACKGROUND_TASK_LAMBDA_ARN,
        InvocationType: "Event",
        Payload: JSON.stringify(listGroupsTask)
    }).promise();

    return {text:"Gathering Available Groups..."};
}

async function registerHandler(words: string[], message: Message): Promise<any> {
    const accountNames = Object.keys(ACCOUNTS).map(accountName => `*${accountName}*`).join(", ");
    const connectorWord = Object.keys(ACCOUNTS).length == 1 ? "is" : "are";

    if (words.length < 2) {
        const helpText = [
            "This command requires an \<username\> and \<account\>.",
            "",
            "For your convenience, you can get your username",
            "from your terminal using:",
            "`aws sts get-caller-identity --query Arn --output text | awk -F'/' '{print $2}'`",
            `and known accounts ${connectorWord} ${accountNames}`
        ];
        return {
            text: helpText.join("\n")
        };
    }

    const username = words.shift();
    const account = words.shift();

    if (!(account in ACCOUNTS)) {
        const accounts = Object.keys(ACCOUNTS).map(accountName => `*${accountName}*`).join(", ");

        const helpText = [
            `The account '${account}' was not recognized`,
            "",
            `The known accounts ${connectorWord} ${accountNames}`
        ];
        return {
            text: helpText.join("\n")
        }
    }
    const accountId = ACCOUNTS[account];

    const createRegistrationVerificationTask: CreateRegistrationVerificationTask = {
        command: "createRegistrationVerification",
        accountId: accountId,
        slackUserId: message.user_id,
        triggerWord: message.command,
        username: username,
        responseUrl: message.response_url
    };

    lambda.invoke({
        FunctionName: SLACK_BOT_BACKGROUND_TASK_LAMBDA_ARN,
        InvocationType: "Event",
        Payload: JSON.stringify(createRegistrationVerificationTask)
    }).promise();

    const response = [
        "Generating registration verification..."
    ];
    return {
        text: response.join("\n")
    }
}

async function verifyHandler(words: string[], message: Message): Promise<any> {
    if (words.length !== 1) {
        return {
            text: "Verification requires a verification token, which was not provided"
        }
    }

    const token = words.shift();
    const completeRegistrationVerificationTask: CompleteRegistrationVerificationTask = {
        command: "completeRegistrationVerification",
        token: token,
        slackUserId: message.user_id,
        responseUrl: message.response_url
    };

    lambda.invoke({
        FunctionName: SLACK_BOT_BACKGROUND_TASK_LAMBDA_ARN,
        InvocationType: "Event",
        Payload: JSON.stringify(completeRegistrationVerificationTask)
    }).promise();

    return {
        text: "Verifying registration..."
    }
}

async function whoamiHandler(words: string[], message: Message): Promise<any> {
    const showUserAccountsTask: ShowUserAccountsTask = {
        command: "showUserAccounts",
        slackUserId: message.user_id,
        accounts: ACCOUNTS,
        responseUrl: message.response_url
    };

    lambda.invoke({
        FunctionName: SLACK_BOT_BACKGROUND_TASK_LAMBDA_ARN,
        InvocationType: "Event",
        Payload: JSON.stringify(showUserAccountsTask)
    }).promise();

    return {
        text: "Gathering Account Information..."
    };
}

async function requestHandler(words: string[], message: Message): Promise<any> {
    if (words.length < 1) {
        return {
            text: "A group name is required. See `groot list` for the set of groups"
        };
    }

    let awsUserName = await getRegisteredUserName(message.user_id);

    if (!awsUserName) {
        return {
            text: "We couldn't find a user registered for you. Try `register <aws_user_name>`"
        };
    }

    let groupName = words.shift();

    let allGroups = getAllGroups();

    debug && console.log("groupName:", groupName, "allGroups:", allGroups);
    if (allGroups.indexOf(groupName) < 0) {
        return {
            text: "Sorry, the group `" + groupName + "` is not in the list of requestable groups. See `list` for the list of requestable groups."
        };
    }

    const id = await createRequest(message.user_name, awsUserName, groupName);

    return {
        text: "`" + message.user_name + "` has requested to join `" + groupName + "`. To approve this use `groot approve " + id + "`"
    };
}

async function approveHandler(words: string[], message: Message): Promise<any> {
    if (words.length < 1) {
        return {
            text: "A request ID is required. Don't be silly."
        };
    }

    const approvers = getApprovers();
    if (approvers.length > 0 && approvers.indexOf(message.user_name) < 0) {
        return {
            text: "I did not recognize `" + message.user_name + "` in the list of approvers."
        };
    }

    let requestId = words.shift();
    let request = await getRequest(requestId);

    debug && console.log("request:", request);

    if (!request) {
        return {
            text: "No request could be found with ID `" + requestId + "`"
        };
    }

    if (request["approvedBy"]) {
        return {
            text: "Request ID `" + requestId + "` already appears to have been approved."
        };
    }

    if (request["slackUser"].S === message.user_name) {
        return {
            text: "One may not approve their own requests."
        };
    }

    await approveRequest(requestId, message.user_name);

    return {
        text: `Request '${requestId}' to add '${request["iamUser"].S}' to group '${request["groupName"]}' approved by ${message.user_name}'.`
    };
}

async function getRegisteredUserName(userId: string): Promise<any> {
    try {
        let getResponse = await dynamo.getItem({
            Key: {
                id: {
                    S: userId
                }
            },
            TableName: usersTableName
        }).promise();

        return getResponse.Item["iamUser"].S;
    }
    catch (err) {
        return null;
    }
}

async function registerUserName(userId: string, userName: string): Promise<any> {
    let putResponse = await dynamo.putItem({
        Item: {
            id: { S: userId},
            iamUser: { S: userName}
        },
        TableName: usersTableName
    }).promise();
}

function getApprovers(): string[] {
    return APPROVERS.trim().split(" ").filter((x: string) => x);
}

function getDevGroups(): string[] {
    return process.env.DEV_GROUPS.trim().split(" ").filter((x: string) => x);
}

function getProdGroups(): string[] {
    return process.env.PROD_GROUPS.trim().split(" ").filter((x: string) => x);
}

function getAllGroups(): string[] {
    return getDevGroups().concat(getProdGroups());
}

async function createRequest(slackUserName: string, awsUserName: string, groupName: string): Promise<any> {
    let id = uuid.v4();
    let requestTime = new Date().getTime();

    let putResponse = await dynamo.putItem({
        Item: {
            id: { S: id },
            requestTime: { N: requestTime.toString() },
            slackUser: { S: slackUserName },
            iamUser: { S: awsUserName },
            groupName: { S: groupName },
            membershipDuration: { N: membershipDurationMinutes.toString() }
        },
        TableName: requestTableName
    }).promise();

    return id;
}

async function getRequest(requestId: string): Promise<aws.DynamoDB.Types.AttributeMap> {
    try {
        let getResponse = await dynamo.getItem({
            Key: {
                id: {
                    S: requestId
                }
            },
            TableName: requestTableName
        }).promise();

        return getResponse.Item;
    }
    catch (err) {
        return null;
    }
}

async function approveRequest(requestId: string, approvingUserName: string) {
    let approvalTime = new Date().getTime();

    let updateRequest = await dynamo.updateItem({
        TableName: requestTableName,
        Key: {
            id: { S: requestId }
        },
        UpdateExpression: "SET approvedBy = :approver, approvedAt = :approvalTime",
        ExpressionAttributeValues: {
            ":approver": { S: approvingUserName },
            ":approvalTime": { N: approvalTime.toString() }
        },
        ReturnValues: "UPDATED_NEW"
    }).promise();
    debug && console.log("updateRequest:", updateRequest);

    let invokeRequest = await lambda.invoke({
        FunctionName: "slack-group-bot_group-updater_dev",
        InvocationType: "Event"
    }).promise();
    debug && console.log("invokeRequest:", invokeRequest);
}
