const http = require("node:http");

function makeRequest(server, requestPath) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = http.request({
      agent: false,
      method: "GET",
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function makeJsonRequest(server, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const text = JSON.stringify(body);
    const request = http.request({
      agent: false,
      method,
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(text),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const responseText = Buffer.concat(chunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: responseText ? JSON.parse(responseText) : null,
        });
      });
    });
    request.on("error", reject);
    request.end(text);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

module.exports = { makeRequest, makeJsonRequest, closeServer };
