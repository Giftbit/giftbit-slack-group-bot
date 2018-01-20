export type IamReaderRequest = ListGroupsRequest | GetUserIdRequest

export type IamReaderResponse = ListGroupsResponse | GetUserIdResponse

export interface ListGroupsRequest {
    command: "listGroups";
}

export interface ListGroupsResponse {
    groups: string[];
}

export interface GetUserIdRequest {
    command: "getUserId";
    username: string;
}

export interface GetUserIdResponse {
    userId: string;
}
