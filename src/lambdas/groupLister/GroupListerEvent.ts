export type GroupListerEvent = ApproveLinkRequest;

export interface GetGroupsRequest {
    command: "getGroups";
}

export interface GetGroupsResponse {
    groups: string[];
}
