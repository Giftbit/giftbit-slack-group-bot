
export type Task = CallbackTask;

export interface CallbackTask {
    command: string;
    responseUrl: string;
}

export interface ListGroupsTask extends CallbackTask {
    command: "listGroups"
    accounts: { [accountName: string]: string }
}