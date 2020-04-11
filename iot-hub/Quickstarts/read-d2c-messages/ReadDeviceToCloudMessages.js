// Copyright (c) Microsoft Corporation.
// Licensed under the MIT Licence.

/*
  This sample demonstrates how to use the Microsoft Azure Event Hubs Client for JavaScript to 
  read messages sent from a device. 

  If you have access to the Event Hubs-compatible endpoint, either via the Azure portal or
  by using the Azure CLI, you can skip the parts in this sample that converts the Iot Hub
  connection string to an Event Hubs compatible one.

  The conversion is done by connecting to the IoT hub endpoint and receiving a redirection
  address to the built-in event hubs. This address is then used in the Event Hubs Client to
  read messages.

  If using the Azure CLI, you will need to run the below before running this sample to get 
  the details required to form the Event Hubs compatible connection string

    az iot hub show --query properties.eventHubEndpoints.events.endpoint --name {your IoT Hub name}
    az iot hub show --query properties.eventHubEndpoints.events.path --name {your IoT Hub name}
    az iot hub policy show --name service --query primaryKey --hub-name {your IoT Hub name}

  For an example that uses checkpointing, follow up this sample with the sample in the 
  eventhubs-checkpointstore-blob package on GitHub at the following link:

  https://github.com/Azure/azure-sdk-for-js/blob/master/sdk/eventhub/eventhubs-checkpointstore-blob/samples/javascript/receiveEventsUsingCheckpointStore.js
*/

const crypto = require("crypto");
const Buffer = require("buffer").Buffer;
const { Connection, ReceiverEvents, isAmqpError, parseConnectionString } = require("rhea-promise");
const { EventHubConsumerClient } = require("@azure/event-hubs");

// If using websockets, uncomment the below require statement
// const WebSocket = require("ws");

// If you need proxy support, uncomment the below code to create proxy agent
// const HttpsProxyAgent = require("https-proxy-agent");
// const proxyAgent = new HttpsProxyAgent(proxyInfo);

// This code is modified from https://docs.microsoft.com/en-us/azure/iot-hub/iot-hub-devguide-security#security-tokens.
function generateSasToken(resourceUri, signingKey, policyName, expiresInMins) {
  resourceUri = encodeURIComponent(resourceUri);

  const expiresInSeconds = Math.ceil(Date.now() / 1000 + expiresInMins * 60);
  const toSign = resourceUri + "\n" + expiresInSeconds;

  // Use the crypto module to create the hmac.
  const hmac = crypto.createHmac("sha256", Buffer.from(signingKey, "base64"));
  hmac.update(toSign);
  const base64UriEncoded = encodeURIComponent(hmac.digest("base64"));

  // Construct authorization string.
  return `SharedAccessSignature sr=${resourceUri}&sig=${base64UriEncoded}&se=${expiresInSeconds}&skn=${policyName}`;
}

/**
 * Converts an IotHub Connection string into an Event Hubs-compatible connection string.
 * @param {string} connectionString An IotHub connection string in the format:
 * `"HostName=<your-iot-hub>.azure-devices.net;SharedAccessKeyName=<KeyName>;SharedAccessKey=<Key>"`
 * @returns {Promise<string>} An Event Hubs-compatible connection string in the format:
 * `"Endpoint=sb://<hostname>;EntityPath=<your-iot-hub>;SharedAccessKeyName=<KeyName>;SharedAccessKey=<Key>"`
 */
async function convertIotHubToEventHubsConnectionString(connectionString) {
  const { HostName, SharedAccessKeyName, SharedAccessKey } = parseConnectionString(
    connectionString
  );

  // Verify that the required info is in the connection string.
  if (!HostName || !SharedAccessKey || !SharedAccessKeyName) {
    throw new Error(`Invalid IotHub connection string.`);
  }

  //Extract the IotHub name from the hostname.
  const [iotHubName] = HostName.split(".");

  if (!iotHubName) {
    throw new Error(`Unable to extract the IotHub name from the connection string.`);
  }

  // Generate a token to authenticate to the service.
  const token = generateSasToken(
    `${HostName}/messages/events`,
    SharedAccessKey,
    SharedAccessKeyName,
    5 // token expires in 5 minutes
  );

  // If using websockets, uncomment the webSocketOptions below
  // If using proxy, then set `webSocketOptions.options` to 
  // { agent: proxyAgent }
  const connectionOptions = {
    transport: "tls",
    host: HostName,
    hostname: HostName,
    username: `${SharedAccessKeyName}@sas.root.${iotHubName}`,
    port: 5671,
    reconnect: false,
    password: token,
    // webSocketOptions: {
    //   webSocket: WebSocket,
    //   url: `wss://${HostName}:443/$servicebus/websocket`,
    //   protocol: ["AMQPWSB10"],
    //   options: {}
    // }
  };

  const connection = new Connection(connectionOptions);
  await connection.open();

  // Create the receiver that will trigger a redirect error.
  const receiver = await connection.createReceiver({
    source: { address: `amqps://${HostName}/messages/events/$management` },
  });

  return new Promise((resolve, reject) => {
    receiver.on(ReceiverEvents.receiverError, (context) => {
      const error = context.receiver && context.receiver.error;
      if (isAmqpError(error) && error.condition === "amqp:link:redirect") {
        const hostname = error.info && error.info.hostname;
        if (!hostname) {
          reject(error);
        } else {
          resolve(
            `Endpoint=sb://${hostname}/;EntityPath=${iotHubName};SharedAccessKeyName=${SharedAccessKeyName};SharedAccessKey=${SharedAccessKey}`
          );
        }
      } else {
        reject(error);
      }
      connection.close().catch(() => {
        /* ignore error */
      });
    });
  });
}

/**
 * Helper method to form a connection string using the information from running the
 * Azure CLI.
 * Note: You need to run Azure CLI as per the comments below outside of this program
 * and fill in the details.
 */
function getEventHubsCompatibleConnectionStringFromAzCLI() {
  // az iot hub show --query properties.eventHubEndpoints.events.endpoint --name {your IoT Hub name}
  const eventHubsCompatibleEndpoint = "Run the az command in the comment above to get the endpoint";

  // az iot hub show --query properties.eventHubEndpoints.events.path --name {your IoT Hub name}
  const eventHubsCompatiblePath = "Run the az command in the comment above to get the path";

  // az iot hub policy show --name service --query primaryKey --hub-name {your IoT Hub name}
  const sharedAccessKey =
    "Run the az comand in the comment above to get the Shared Access Key vaule";

  return `Endpoint=${eventHubsCompatibleEndpoint}/;EntityPath=${eventHubsCompatiblePath};SharedAccessKeyName=service;SharedAccessKey=${sharedAccessKey}`;
}

var printError = function (err) {
  console.log(err.message);
};

// Display the message content - telemetry and properties.
// - Telemetry is sent in the message body
// - The device can add arbitrary properties to the message
// - IoT Hub adds system properties, such as Device Id, to the message.
var printMessages = function (messages) {
  for (const message of messages) {
    console.log("Telemetry received: ");
    console.log(JSON.stringify(message.body));
    console.log("Properties (set by device): ");
    console.log(JSON.stringify(message.properties));
    console.log("System properties (set by IoT Hub): ");
    console.log(JSON.stringify(message.systemProperties));
    console.log("");
  }
};

async function main() {
  console.log("IoT Hub Quickstarts - Read device to cloud messages.");

  const iotHubConnectionString = "{your Iot Hub connection string}";

  // You can skip calling convertIotHubToEventHubsConnectionString() to do the conversion
  // if you already have access to the Event Hubs compatible connection string from the
  // Azure portal or the Azure CLI
  // If using the Azure CLI, see the getEventHubsCompatibleConnectionStringFromAzCLI() helper
  // method to form the connection string
  const eventHubsConnectionString = await convertIotHubToEventHubsConnectionString(
    iotHubConnectionString
  );

  // If using websockets, uncomment the webSocketOptions below
  // If using proxy, then set `webSocketConstructorOptions` to
  // { agent: proxyAgent }
  const clientOptions = {
    // webSocketOptions: {
    //   webSocket: WebSocket,
    //   webSocketConstructorOptions: {}
    // }
  };

  const consumerClient = new EventHubConsumerClient(
    "$Default",
    eventHubsConnectionString,
    clientOptions
  );
  consumerClient.subscribe({
    processEvents: printMessages,
    processError: printError,
  });
}

main().catch((error) => {
  console.error("Error running sample:", error);
});
