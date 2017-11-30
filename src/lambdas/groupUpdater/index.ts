import "babel-polyfill";
import * as awslambda from "aws-lambda";
import * as aws from "aws-sdk";

const debug = true;

const requestTableName = "giftbit-slack-bot-requests";

let iam = new aws.IAM();
let dynamo = new aws.DynamoDB();

export default function (evt: any, ctx: awslambda.Context, callback: awslambda.Callback): void {
    debug && console.log("event", JSON.stringify(evt, null, 2));
    handleMessage(evt, ctx)
        .then(res => {
            callback(null, res);
        }, err => {
            console.error(err);
            callback(err);
        });
}

async function handleMessage(evt: any, ctx: awslambda.Context): Promise<any> {
    await addApprovedUsers();
    await removeExpiredUsers();
}

async function addApprovedUsers(): Promise<any> {
    let addRequests = await getRequestsRequiringAdd();

    for (let request of addRequests) {
        await addUserToGroup(request);
    }
}

async function removeExpiredUsers(): Promise<any> {
    let removeRequests = await getRequestsRequiringRemove();

    for (let request of removeRequests) {
        await removeUserFromGroup(request);
    }
}

async function getRequestsRequiringAdd(): Promise<aws.DynamoDB.Types.ItemList> {
    let now = new Date().getTime().toString();

    let scanResponse = await dynamo.scan({
        TableName: requestTableName,
        FilterExpression: "#apprAt < :now AND attribute_not_exists (addedAt)",
        ExpressionAttributeNames: {
            "#apprAt": "approvedAt"
        },
        ExpressionAttributeValues: {
            ":now": { N: now }
        },
        ProjectionExpression: "id, #apprAt, iamUser, groupName, membershipDuration"
    }).promise();
    debug && console.log("scanResponse:", scanResponse);
    return scanResponse.Items;
}

async function addUserToGroup(request: aws.DynamoDB.Types.AttributeMap): Promise<any> {
    let iamUser = request["iamUser"].S;
    let groupName = request["groupName"].S;
    let requestId = request["id"].S;
    let duration = Number(request["membershipDuration"].N);

    await iam.addUserToGroup({
        UserName: iamUser,
        GroupName: groupName
    }).promise();

    await updateRequestAddedTime(requestId, duration);
}

async function updateRequestAddedTime(requestId: string, duration: number): Promise<any> {
    let now = new Date().getTime();
    let expiry = now + (duration * 60 * 1000);

    let updateResponse = await dynamo.updateItem({
        TableName: requestTableName,
        Key: {
            id: { S: requestId }
        },
        UpdateExpression: "SET addedAt = :addedAt, removeAfter = :expiry",
        ExpressionAttributeValues: {
            ":addedAt": { N: now.toString() },
            ":expiry": { N: expiry.toString() }
        },
        ReturnValues: "UPDATED_NEW"
    }).promise();
    debug && console.log("updateResponse:", updateResponse);
}

async function getRequestsRequiringRemove(): Promise<aws.DynamoDB.Types.ItemList> {
    let now = new Date().getTime().toString();

    let scanResponse = await dynamo.scan({
        TableName: requestTableName,
        FilterExpression: "#removeAfter < :now AND attribute_not_exists (removedAt)",
        ExpressionAttributeNames: {
            "#removeAfter": "removeAfter"
        },
        ExpressionAttributeValues: {
            ":now": { N: now }
        },
        ProjectionExpression: "id, #removeAfter, iamUser, groupName"
    }).promise();
    debug && console.log("scanResponse:", scanResponse);
    return scanResponse.Items;
}

async function removeUserFromGroup(request: aws.DynamoDB.Types.AttributeMap): Promise<any> {
    let iamUser = request["iamUser"].S;
    let groupName = request["groupName"].S;
    let requestId = request["id"].S;

    await iam.removeUserFromGroup({
        UserName: iamUser,
        GroupName: groupName
    }).promise();

    await updateRequestRemovedTime(requestId);
}

async function updateRequestRemovedTime(requestId: string): Promise<any> {
    let now = new Date().getTime();

    let updateResponse = await dynamo.updateItem({
        TableName: requestTableName,
        Key: {
            id: { S: requestId }
        },
        UpdateExpression: "SET removedAt = :removedAt",
        ExpressionAttributeValues: {
            ":removedAt": { N: now.toString() }
        },
        ReturnValues: "UPDATED_NEW"
    }).promise();
    debug && console.log("updateResponse:", updateResponse);
}
