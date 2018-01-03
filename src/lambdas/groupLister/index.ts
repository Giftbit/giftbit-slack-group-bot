import "babel-polyfill";
import * as awslambda from "aws-lambda";
import * as aws from "aws-sdk";
import {GetGroupsResponse} from "./GroupListerEvent";

let iam = new aws.IAM();

const GROUP_BOT_GROUP_PREFIX = "/groupbot/";

export function handler(event: any, context: awslambda.Context, callback: awslambda.Callback): void {
    console.log("event", JSON.stringify(event, null, 2));
    handlerAsync(event, context)
        .then(res => {
            callback(undefined, res);
        }, err => {
            console.error(JSON.stringify(err, null, 2));
            callback(err);
        });
}

async function handlerAsync(event: any, context: awslambda.Context): Promise<GetGroupsResponse> {
    const listGroupsResponse: aws.IAM.Types.ListGroupsResponse = await iam.listGroups({PathPrefix: GROUP_BOT_GROUP_PREFIX}).promise();

    const accountGroups = listGroupsResponse.Groups.map((group) => group.GroupName);

    return {
        groups: accountGroups
    };
}
