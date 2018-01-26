#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# A few bash commands to make development against dev environment easy.
# Set the properties below to sensible values for your project.

# The name of your CloudFormation stack.  Two developers can share a stack by
# sharing this value, or have their own with different values.
STACK_NAME="SlackIamGroupBot"

# The name of an S3 bucket on your account to hold deployment artifacts.
#BUILD_ARTIFACT_BUCKET=""
#BUILD_ARTIFACT_BUCKET="dev-lightraildevartifacts-ywjp7wt8djk7-bucket-1mlnqtwvk2jzf"

# Parameter values for the sam template.  see: `aws cloudformation deploy help`
#PARAMETER_OVERRIDES=""
#PARAMETER_OVERRIDES='--parameter-overrides GroupBotProject=GroupBot Accounts={"account1":"123456789012"} SlackToken=yourSlackToken'

USAGE="usage: $0 <command name>\nvalid command names: build delete deploy invoke upload"

if ! type "aws" &> /dev/null; then
    echo "'aws' was not found in the path.  Install awscli and try again."
    exit 1
fi

if [ $# -lt 1 ]; then
    echo "Error: expected a command."
    echo -e $USAGE
    exit 2
fi

if [ -z "$BUILD_ARTIFACT_BUCKET" ]; then
    echo "The BUILD_ARTIFACT_BUCKET property was not set. This is the name of the \
S3 bucket that will back the Packaged Resources, and should be in the same region you would like to host the \
lambdas in."
    exit 3
fi

set -eu

COMMAND="$1"


if [ "$COMMAND" = "build" ]; then
    # Build one or more lambda functions.
    # eg: ./auto.sh build rest rollup

    BUILD_ARGS=""
    if [ "$#" -ge 2 ]; then
        BUILD_ARGS="--env.fxn=$2"
        for ((i=3;i<=$#;i++)); do
            BUILD_ARGS="$BUILD_ARGS,${!i}";
        done
    fi

    npm run build -- $BUILD_ARGS


elif [ "$COMMAND" = "delete" ]; then
    aws cloudformation delete-stack --stack-name $STACK_NAME


elif [ "$COMMAND" = "package" ]; then
    # Package the CloudFormation Templates for easy Deployment
    # eg: ./auto.sh package

    npm run build

    BUILD_DATE="$(date "+%s")"

    SLACK_BOT_TEMPLATE_NAME="slackbot.$BUILD_DATE.yaml"
    IAM_AGENT_TEMPLATE_NAME="iam-agent.$BUILD_DATE.yaml"

    aws cloudformation package --template-file infrastructure/slackbot.yaml --s3-bucket $BUILD_ARTIFACT_BUCKET --output-template-file /tmp/$SLACK_BOT_TEMPLATE_NAME
    aws s3 cp /tmp/$SLACK_BOT_TEMPLATE_NAME s3://$BUILD_ARTIFACT_BUCKET/cloudformation/$SLACK_BOT_TEMPLATE_NAME

    aws cloudformation package --template-file infrastructure/slackbot.yaml --s3-bucket $BUILD_ARTIFACT_BUCKET --output-template-file /tmp/$IAM_AGENT_TEMPLATE_NAME
    aws s3 cp /tmp/$IAM_AGENT_TEMPLATE_NAME s3://$BUILD_ARTIFACT_BUCKET/cloudformation/$IAM_AGENT_TEMPLATE_NAME

    echo ""
    echo "The Slack IAM Group Bot resources have been deployed. You can find them at the following URLS"
    echo "SlackBot: https://$BUILD_ARTIFACT_BUCKET.s3.amazonaws.com/cloudformation/$SLACK_BOT_TEMPLATE_NAME"
    echo "IAM Agent: https://$BUILD_ARTIFACT_BUCKET.s3.amazonaws.com/cloudformation/$IAM_AGENT_TEMPLATE_NAME"

elif [ "$COMMAND" = "deploy" ]; then
    # Deploy all code and update the CloudFormation stack.
    # eg: ./auto.sh deploy [cloudformation_template]

    set +u
    TEMPLATE="$2"
    if [ -z "$TEMPLATE" ]; then
        TEMPLATE=slackbot
    fi
    set -u

    npm run build

    OUTPUT_TEMPLATE_FILE="/tmp/SlackGroupBot.`date "+%s"`.yaml"
    aws cloudformation package --template-file infrastructure/$TEMPLATE.yaml --s3-bucket $BUILD_ARTIFACT_BUCKET --output-template-file "$OUTPUT_TEMPLATE_FILE"

    echo "Executing aws cloudformation deploy..."
    aws cloudformation deploy --template-file "$OUTPUT_TEMPLATE_FILE" --stack-name $STACK_NAME --capabilities CAPABILITY_NAMED_IAM $PARAMETER_OVERRIDES

    if [ $? -ne 0 ]; then
        # Print some help on why it failed.
        echo ""
        echo "Printing recent CloudFormation errors..."
        aws cloudformation describe-stack-events --stack-name $STACK_NAME --query 'reverse(StackEvents[?ResourceStatus==`CREATE_FAILED`||ResourceStatus==`UPDATE_FAILED`].[ResourceType,LogicalResourceId,ResourceStatusReason])' --output text
        exit 4
    fi

    # cleanup
    rm "$OUTPUT_TEMPLATE_FILE"


elif [ "$COMMAND" = "invoke" ]; then
    # Invoke a lambda function.
    # eg: ./auto.sh invoke slackbot myfile.json

    if [ "$#" -ne 3 ]; then
        echo "Supply a function name to invoke and json file to invoke with.  eg: $0 invoke myfunction myfile.json"
        exit 1
    fi

    FXN="$2"
    JSON_FILE="$3"

    if [ ! -d "./src/lambdas/$FXN" ]; then
        echo "$FXN is not the directory of a lambda function in src/lambdas."
        exit 2
    fi

    if [ ! -f $JSON_FILE ]; then
        echo "$JSON_FILE does not exist.";
        exit 3
    fi

    # Search for the ID of the function assuming it was named something like FxnFunction where Fxn is the uppercased form of the dir name.
    FXN_UPPERCASE="$(tr '[:lower:]' '[:upper:]' <<< ${FXN:0:1})${FXN:1}"
    FXN_ID="$(aws cloudformation describe-stack-resources --stack-name $STACK_NAME --query "StackResources[?ResourceType==\`AWS::Lambda::Function\`&&starts_with(LogicalResourceId,\`$FXN_UPPERCASE\`)].PhysicalResourceId" --output text)"
    if [ $? -ne 0 ]; then
        echo "Could not discover the LogicalResourceId of $FXN.  Check that there is a ${FXN_UPPER_CAMEL_CASE}Function Resource inside infrastructure/slackbot.yaml and check that it has been deployed."
        exit 1
    fi

    aws --cli-read-timeout 300 lambda invoke --function-name $FXN_ID --payload fileb://$JSON_FILE /dev/stdout


elif [ "$COMMAND" = "upload" ]; then
    # Upload new lambda function code.
    # eg: ./auto.sh upload myfunction

    if [ "$#" -ne 2 ]; then
        echo "Supply a function name to build and upload.  eg: $0 upload myfunction"
        exit 1
    fi

    FXN="$2"

    if [ ! -d "./src/lambdas/$FXN" ]; then
        echo "$FXN is not the directory of a lambda function in src/lambdas."
        exit 2
    fi

    npm run build -- --env.fxn=$FXN

    # Search for the ID of the function assuming it was named something like FxnFunction where Fxn is the uppercased form of the dir name.
    FXN_UPPERCASE="$(tr '[:lower:]' '[:upper:]' <<< ${FXN:0:1})${FXN:1}"
    FXN_ID="$(aws cloudformation describe-stack-resources --stack-name $STACK_NAME --query "StackResources[?ResourceType==\`AWS::Lambda::Function\`&&starts_with(LogicalResourceId,\`$FXN_UPPERCASE\`)].PhysicalResourceId" --output text)"
    if [ $? -ne 0 ]; then
        echo "Could not discover the LogicalResourceId of $FXN.  Check that there is a ${FXN_UPPER_CAMEL_CASE}Function Resource inside infrastructure/sam.yaml and check that it has been deployed."
        exit 1
    fi

    aws lambda update-function-code --function-name $FXN_ID --zip-file fileb://./dist/$FXN/$FXN.zip

else
    echo "Error: unknown command name '$COMMAND'."
    echo -e $USAGE
    exit 2

fi
