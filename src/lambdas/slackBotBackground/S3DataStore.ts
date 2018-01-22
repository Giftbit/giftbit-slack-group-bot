import "babel-polyfill";
import * as aws from "aws-sdk";

const s3 = new aws.S3();

export class S3DataStore {
    bucketName: string;

    constructor (bucketName: string) {
        this.bucketName = bucketName;
    }

    public async getObject(key: string): Promise<string> {
        const getObjectRequest = {
            Bucket: this.bucketName,
            Key: key
        };
        const getObjectResponse = await s3.getObject(getObjectRequest).promise();
        return getObjectResponse.Body.toString();
    }

    public async putObject(body: string, key: string): Promise<void> {
        let params: aws.S3.Types.PutObjectRequest = {
            Body: body,
            Bucket: this.bucketName,
            Key: key
        };
        await s3.putObject(params).promise();
    }

    public async deleteObject(key: string): Promise<void> {
        const deleteObjectRequest: aws.S3.Types.DeleteObjectRequest = {
            Bucket: this.bucketName,
            Key: key
        };
        await s3.deleteObject(deleteObjectRequest).promise();
    }

    public async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
        const copyObjectRequest: aws.S3.Types.CopyObjectRequest = {
            Bucket: this.bucketName,
            CopySource: `/${this.bucketName}/${sourceKey}`,
            Key: destinationKey
        };
        await s3.copyObject(copyObjectRequest).promise();
    }

}