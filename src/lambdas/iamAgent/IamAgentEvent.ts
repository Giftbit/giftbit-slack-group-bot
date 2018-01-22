export type IamReaderRequest = ListGroupsRequest | GetUserIdRequest | AddUserToGroupRequest | RemoveUserFromGroupRequest

export type IamReaderResponse = ListGroupsResponse | GetUserIdResponse | AddUserToGroupResponse | RemoveUserFromGroupResponse

export interface ListGroupsRequest {
    command: "listGroups";
}

export interface ListGroupsResponse {
    groups: string[];
}

export interface GetUserIdRequest {
    command: "getUserId";
    userName: string;
}

export interface GetUserIdResponse {
    userId: string;
}

export interface AddUserToGroupRequest {
    command: "addUserToGroup"
    userName: string;
    groupName: string;
}

export interface AddUserToGroupResponse {
    userAddSuccessful: boolean
}

export interface RemoveUserFromGroupRequest {
    command: "removeUserFromGroup"
    userName: string;
    groupName: string;
}

export interface RemoveUserFromGroupResponse {
    userRemovalSuccessful: boolean
}