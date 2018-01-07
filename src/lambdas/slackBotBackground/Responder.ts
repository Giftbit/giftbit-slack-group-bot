import * as urllib from "url";
import * as https from "https";

export async function sendResponse (body: any, url: string): Promise<void> {
    const webhookURL = urllib.parse(url);

    console.log("postData:", body);

    const content = JSON.stringify(body);

    const postOptions = {
        host: webhookURL.host,
        path: webhookURL.path,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(content)
        }
    };

    await new Promise((resolve,reject) => {
        const request = https.request(postOptions, (response) => {
            console.log(`response.statusCode ${response.statusCode}`);
            console.log(`response.headers ${JSON.stringify(response.headers)}`);
            resolve();
        });

        request.on("error", (error) => {
            console.log("sendResponse error", error);
            reject(error);
        });

        request.on("end", () => {
            console.log("end");
        });

        request.write(content);
        request.end();
    });
}