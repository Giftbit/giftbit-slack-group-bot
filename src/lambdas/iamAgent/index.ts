import "babel-polyfill";
import * as awslambda from "aws-lambda";
import * as aws from "aws-sdk";
import {
    GetUserIdRequest, GetUserIdResponse, IamReaderRequest, IamReaderResponse, ListGroupsRequest,
    ListGroupsResponse
} from "./IamAgentEvent";

const debug = true;
let iam = new aws.IAM();

const GROUP_BOT_GROUP_PREFIX = "/groupbot/";

type IamTask = (request: IamReaderRequest) => Promise<IamReaderResponse>;

const handlers: { [ key: string]: IamTask} = {
    listGroups: listGroupsHandler,
    getUserId: getUserIdHandler,
};

export function handler(request: IamReaderRequest, context: awslambda.Context, callback: awslambda.Callback): void {
    console.log("request", JSON.stringify(request, null, 2));
    handlerAsync(request, context)
        .then(res => {
            callback(undefined, res);
        }, err => {
            console.error(JSON.stringify(err, null, 2));
            callback(err);
        });
}

async function handlerAsync(request: IamReaderRequest, context: awslambda.Context): Promise<IamReaderResponse> {
    const command = request.command;

    if (!(command in handlers)) {
        throw new Error(`Command '${command}' was not recognized`);
    }

    return await handlers[command](request);
}

async function listGroupsHandler(request: ListGroupsRequest): Promise<ListGroupsResponse> {
    const listGroupsResponse: aws.IAM.Types.ListGroupsResponse = await iam.listGroups({PathPrefix: GROUP_BOT_GROUP_PREFIX}).promise();
    debug && console.log("ListGroupsResponse",listGroupsResponse);

    const accountGroups = listGroupsResponse.Groups.map((group) => group.GroupName);

    return {
        groups: accountGroups
    };
}

async function getUserIdHandler(request: GetUserIdRequest): Promise<GetUserIdResponse> {
    const getUserResponse: aws.IAM.Types.GetUserResponse = await iam.getUser({UserName: request.username}).promise();
    debug && console.log("GetUserResponse",getUserResponse);

    return {
        userId: getUserResponse.User.UserId
    }
}