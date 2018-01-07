import "babel-polyfill";
import {ListGroupsTask, Task} from "./Task";
import * as aws from "aws-sdk";
import * as awslambda from "aws-lambda";
import {sendResponse} from "./Responder";
import {GetGroupsResponse} from "../groupLister/GroupListerEvent";

let lambda = new aws.Lambda();
const debug = true;

const GROUP_BOT_PROJECT = process.env.GROUP_BOT_PROJECT;
const REGION = process.env.REGION;

type TaskHandler = (task: Task) => Promise<void>;

const handlers: { [ key: string]: TaskHandler} = {
    listGroups: listGroupsHandler
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

        const lambdaPromise =  lambda.invoke({
            FunctionName: `arn:aws:lambda:${REGION}:${accountId}:function:${GROUP_BOT_PROJECT}-GroupLister`,
            InvocationType: "RequestResponse"
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
            const getGroupsResponse: GetGroupsResponse = JSON.parse(lambdaResponse.Payload.toString());
            debug && console.log("groups", getGroupsResponse);

            if (responseLines.length > 0) {
                responseLines.push("");
            }
            if (getGroupsResponse.groups.length > 0) {
                responseLines.push(`${accountGroupsRequest.accountName}:`);
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