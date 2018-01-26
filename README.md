# slack-iam-group-bot

Granting temporary IAM Group access, made easy

## What is the Slack IAM Group Bot

The Slack IAM Group Bot allows for Slack Users to authenticate themselves, and easily
request access to permissions through a set of groups. For example, I might have an
`IAMAdmin` group in my AWS Account, but Least Privilege, users shouldn't have access to
it all of the time. We could log in as Root, and add someone manually to the group, then
remove them when they are finished. Slack IAM Group bot makes this easy. Instead of
naming the group `IAMAdmin` if I name the group `groupbot/IAMAdmin` then groupbot can
manage group access for me.




## Deploying

### Dependencies

#### S3 Bucket

You will need to have an S3 bucket that is accessible to any of the accounts you want
to deploy the group bot to, in order to be able to deploy the template. You can do this
by applying a policy like the following:

```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "AWS": [
                    "123456789012",
                    "234567890123"
                ]
            },
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::slack-iam-group-bot/*"
        }
    ]
}
```

Where `1234556789012` and `234567890123` represent the account IDs to have access and `slack-iam-group-bot`
represents the bucket name.

### Packaging the project

Next, with the bucket you created above as `<your_bucket_name>`, you can run the
`BUILD_ARTIFACT_BUCKET=<your_bucket_name> ./auto.sh package` command to package all
of the lambdas and templates, and push a build of them to the S3 bucket. This command
will return the URLs for the SlackBot and the IAM Agent CloudFormation Templates.

### Deploying to CloudFormation

#### Slack Group Bot (Main Account)

With the Slack Group Bot template url from the previous step, you can go to the
[CloudFormation Create Stack](https://console.aws.amazon.com/cloudformation/home#/stacks/new)
page, press Specify an Amazon S3 template URL, and enter the Slack Bot Template URL into
the box. On the next page, you will


You can use the `./auto.sh package` command. This will package up all of the lambdas and
