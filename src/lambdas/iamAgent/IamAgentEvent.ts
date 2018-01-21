export type IamReaderRequest = ListGroupsRequest | GetUserIdRequest | AddUserToGroupRequest

export type IamReaderResponse = ListGroupsResponse | GetUserIdResponse | AddUserToGroupResponse

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