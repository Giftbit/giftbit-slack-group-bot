import "babel-polyfill";
import * as awslambda from "aws-lambda";
import * as aws from "aws-sdk";
import {
    AddUserToGroupRequest, AddUserToGroupResponse,
    GetUserIdRequest, GetUserIdResponse, IamReaderRequest, IamReaderResponse, ListGroupsRequest,
    ListGroupsResponse, RemoveUserFromGroupRequest, RemoveUserFromGroupResponse
} from "./IamAgentEvent";

const debug = true;
let iam = new aws.IAM();

const GROUP_BOT_GROUP_PREFIX = "/groupbot/";

type IamTask = (request: IamReaderRequest) => Promise<IamReaderResponse>;

const handlers: { [ key: string]: IamTask} = {
    listGroups: listGroupsHandler,
    getUserId: getUserIdHandler,
    addUserToGroup: addUserToGroupHandler,
    removeUserFromGroup: removeUserFromGroupHandler,
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
    const getUserResponse: aws.IAM.Types.GetUserResponse = await iam.getUser({UserName: request.userName}).promise();
    debug && console.log("GetUserResponse",getUserResponse);

    return {
        userId: getUserResponse.User.UserId
    }
}

async function addUserToGroupHandler(request: AddUserToGroupRequest): Promise<AddUserToGroupResponse> {
    const userName = request.userName;
    const groupName = request.groupName;

    let userAddSuccessful: boolean = false;

    try {
        await iam.addUserToGroup({UserName: userName, GroupName: groupName});
        userAddSuccessful = true;
    }
    catch (err) {
        console.error(`An error occurred adding user '${userName}' to group '${groupName}'`, err);
    }
    return {
        userAddSuccessful: userAddSuccessful
    }
}

async function removeUserFromGroupHandler(request: RemoveUserFromGroupRequest): Promise<RemoveUserFromGroupResponse> {
    const userName = request.userName;
    const groupName = request.groupName;

    let userRemovalSuccessful: boolean = false;

    try {
        await iam.removeUserFromGroup({UserName: userName, GroupName: groupName});
        userRemovalSuccessful = true;
    } catch (err) {
        console.error(`An error occurred removing user '${userName}' from group '${groupName}'`, err)
    }
    return {
        userRemovalSuccessful: userRemovalSuccessful
    }
}