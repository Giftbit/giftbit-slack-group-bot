import "babel-polyfill";
import * as awslambda from "aws-lambda";
import * as aws from "aws-sdk";
import {GetGroupsRequest, GetGroupsResponse} from "./GroupListerEvent";

let iam = new aws.IAM();

const GROUP_BOT_GROUP_PREFIX = "groupbot_";
const CONNECTED_ACCOUNT_ID = process.env.CONNECTED_ACCOUNT_ID;

const handlers: { [ key: string]: (event: GroupListerEvent, context: awslambda.Context) => Promise<any>} = {
    "getGroups": getGroupsHandler
};

export function handler(event: GroupListerEvent, context: awslambda.Context, callback: awslambda.Callback): void {
    console.log("event", JSON.stringify(event, null, 2));
    handlerAsync(event, context)
        .then(res => {
            callback(undefined, res);
        }, err => {
            console.error(JSON.stringify(err, null, 2));
            callback(err);
        });
}

async function handlerAsync(event: GroupListerEvent, context: awslambda.Context): Promise<any> {
    if (!(event.command in handlers)) {
        throw new Error(`Unknown Command '${event.command}`);
    }

    return await handlers[event.command](event, context);
}

async function getGroupsHandler(event: GetGroupsRequest): Promise<GetGroupsResult> {
    const listGroupsResponse: aws.IAM.Types.ListGroupsResponse = await iam.listGroups({PathPrefix: GROUP_BOT_GROUP_PREFIX}).promise();

    const accountGroups = listGroupsResponse.Groups.map((group) => {
        return group.Name.replace(GROUP_BOT_GROUP_PREFIX, "");
    });

    return {
        groups: accountGroups
    };
}
