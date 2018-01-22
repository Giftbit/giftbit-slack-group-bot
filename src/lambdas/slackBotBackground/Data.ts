export type Username = string;

export interface GroupAdditionRequest {
    accountId: string;
    accountName: string;
    requesterSlackName: string;
    requesterSlackId: string;
    userName: string;
    groupName: string;
    membershipDurationMinutes: number;
}

export interface GroupAdditionApproval {
    accountId: string;
    accountName: string;
    requesterSlackName: string;
    requesterSlackId: string;
    approverSlackName: string;
    approverSlackId: string;
    userName: string;
    groupName: string;
}
