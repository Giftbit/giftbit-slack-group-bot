import "babel-polyfill";
import * as awslambda from "aws-lambda";
import * as aws from "aws-sdk";
import * as uuid from "node-uuid";
import {Message} from "./Message";
import {
    ListGroupsTask, CreateRegistrationVerificationTask,
    CompleteRegistrationVerificationTask, ShowUserAccountsTask, GroupAdditionRequestTask, GroupAdditionApprovalTask,
} from "../slackBotBackground/Task";

const debug = true;

const ACCOUNT_ID =  process.env.ACCOUNT_ID;
const ACCOUNTS: { [accountName: string]: string } = JSON.parse(process.env.ACCOUNTS);
const TOKEN = process.env.TOKEN;
const APPROVERS = process.env.APPROVERS || "";
const SLACK_BOT_BACKGROUND_TASK_LAMBDA_ARN = process.env.SLACK_BOT_BACKGROUND_TASK_LAMBDA_ARN;
const DATA_STORE_BUCKET = process.env.DATA_STORE_BUCKET;

const REQUEST_VALID_MINUTES = 30;
const MEMBERSHIP_DURATION_MINUTES = 60;

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
    "whoami": "Displays your registered AWS IAM userName",
    "request <group_name> <account>": "Creates a request to be added to a group temporarily",
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
            "This command requires an <userName> and <account>.",
            `Usage: \`${message.command} register <username> <account>\``,
            "",
            "For your convenience, you can get your userName",
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
            `The account *${account}* was not recognized`,
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
    const groupName = words.shift();
    const accountName = words.shift();

    if (!(groupName && accountName)) {
        const responseLines = [
            "A group name and an account are required.",
            `Usage: \`${message.command} request <group_name> <account>\``,
            "",
            `See \`${message.command} list\` for the set of available groups`
        ];
        return {
            text: responseLines.join("\n")
        };
    }

    if (!(accountName in ACCOUNTS)) {
        const accountNames = Object.keys(ACCOUNTS).map(anAccountName => `*${anAccountName}*`).join(", ");
        const connectorWord = Object.keys(ACCOUNTS).length == 1 ? "is" : "are";
        const plural = Object.keys(ACCOUNTS).length != 1 ? "" : "s";
        const responseLines = [
            `Account name *${accountName}* was not recognized`,
            "",
            `The known account${plural} ${connectorWord} ${accountNames}`
        ];
        return {
            text: responseLines.join("\n")
        }
    }

    const accountId = ACCOUNTS[accountName];
    const groupAdditionRequestTask: GroupAdditionRequestTask = {
        command: "groupAdditionRequest",
        accountId: accountId,
        accountName: accountName,
        slackUserId: message.user_id,
        slackUserName: message.user_name,
        groupName: groupName,
        triggerWord: message.command,
        validForSeconds: REQUEST_VALID_MINUTES * 60,
        membershipDurationMinutes: MEMBERSHIP_DURATION_MINUTES,
        responseUrl: message.response_url
    };
    lambda.invoke({
        FunctionName: SLACK_BOT_BACKGROUND_TASK_LAMBDA_ARN,
        InvocationType: "Event",
        Payload: JSON.stringify(groupAdditionRequestTask)
    }).promise();

    return {
        text: "Validating request..."
    };
}

async function approveHandler(words: string[], message: Message): Promise<any> {
    if (words.length < 1) {
        const responseLines = [
            "A Request ID is required to approve a request",
            "",
            `Usage: \`${message.command} approve <request_id>\``,
        ];
        return {
            text: responseLines.join("\n")
        }
    }

    const approvers = APPROVERS.split(",").map(approver => approver.trim()).filter(approver => approver);
    debug && console.log("approvers",approvers);
    if (approvers.length > 0 && approvers.indexOf(message.user_name) < 0) {
        return {
            text: `${message.user_name} was not recognized as an approver`
        };
    }

    let requestId = words.shift();

    const groupAdditionApprovalTask: GroupAdditionApprovalTask = {
        command: "groupAdditionApproval",
        slackUserId: message.user_id,
        slackUserName: message.user_name,
        requestId: requestId,
        responseUrl: message.response_url
    };
    lambda.invoke({
        FunctionName: SLACK_BOT_BACKGROUND_TASK_LAMBDA_ARN,
        InvocationType: "Event",
        Payload: JSON.stringify(groupAdditionApprovalTask)
    }).promise();

    return {
        text: `Validating Request...`
    };
}
