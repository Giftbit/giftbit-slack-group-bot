
export type Task = CallbackTask;

export interface CallbackTask {
    command: string;
    responseUrl: string;
}

export interface ListGroupsTask extends CallbackTask {
    command: "listGroups";
    accounts: { [accountName: string]: string }
}

export interface CreateRegistrationVerificationTask extends CallbackTask {
    command: "createRegistrationVerification";
    username: string;
    accountId: string;
    slackUserId: string;
    triggerWord: string;
}

export interface CompleteRegistrationVerificationTask extends CallbackTask {
    command: "completeRegistrationVerification";
    slackUserId: string;
    token: string;
}

export interface ShowUserAccountsTask extends CallbackTask {
    command: "showUserAccounts";
    accounts: { [accountName: string]: string };
    slackUserId: string;
}

export interface GroupAdditionRequestTask extends CallbackTask {
    command: "groupAdditionRequest";
    slackUserId: string;
    accountId: string;
    accountName: string;
    groupName: string;
    triggerWord: string;
}
