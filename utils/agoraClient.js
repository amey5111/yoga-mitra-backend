const axios = require("axios");
require("dotenv").config();

/*
  Agora helper: RTC token generation + Cloud Recording (REST).
  All credentials come from environment variables so the app runs even before
  they are set. When a credential is missing the relevant call degrades to a
  clear, catchable error instead of crashing the server.

  Required env for live video:
    AGORA_APP_ID           - Agora project App ID
    AGORA_APP_CERTIFICATE  - primary certificate (leave empty for testing mode)
  Required env for cloud recording:
    AGORA_CUSTOMER_ID      - REST customer key
    AGORA_CUSTOMER_SECRET  - REST customer secret
    AGORA_STORAGE_VENDOR   - 1 AWS, 2 Alibaba, 3 Tencent, 6 GCS ... (number)
    AGORA_STORAGE_REGION   - region code for the vendor (number)
    AGORA_STORAGE_BUCKET   - bucket name
    AGORA_STORAGE_KEY      - bucket access key
    AGORA_STORAGE_SECRET   - bucket secret key
*/

const APP_ID = process.env.AGORA_APP_ID || "";
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || "";
const CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID || "";
const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET || "";

// Load the token builder lazily so the module still loads if the package is
// not installed yet (syntax check / partial setup).
let RtcTokenBuilder = null;
let RtcRole = null;
try {
  const agora = require("agora-token");
  RtcTokenBuilder = agora.RtcTokenBuilder;
  RtcRole = agora.RtcRole;
} catch (_) {
  console.log(
    "[agora] agora-token package not installed yet. Run: npm install agora-token",
  );
}

const isTokenConfigured = () => !!APP_ID;
const isRecordingConfigured = () =>
  !!(CUSTOMER_ID && CUSTOMER_SECRET && process.env.AGORA_STORAGE_BUCKET);

/*
  Build an RTC token for a channel + numeric uid.
  role: "host" (publish video/audio) or "audience" (view only).
  If no certificate is set (Agora "testing mode") an empty token is returned,
  which Agora accepts for a project without a certificate.
*/
function buildRtcToken(channelName, uid, role = "audience") {
  if (!APP_CERTIFICATE) return ""; // testing mode: null/empty token is valid
  if (!RtcTokenBuilder) {
    throw new Error("agora-token package is not installed");
  }
  const rtcRole = role === "host" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
  const expireSeconds = 60 * 60 * 4; // 4 hours
  const now = Math.floor(Date.now() / 1000);
  const privilegeExpire = now + expireSeconds;
  return RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERTIFICATE,
    channelName,
    Number(uid),
    rtcRole,
    expireSeconds,
    privilegeExpire,
  );
}

/* --- Cloud Recording (composite / "mix" mode) --- */

function recordingAuthHeader() {
  const plain = `${CUSTOMER_ID}:${CUSTOMER_SECRET}`;
  return "Basic " + Buffer.from(plain).toString("base64");
}

const recBase = () => `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording`;

function storageConfig() {
  return {
    vendor: Number(process.env.AGORA_STORAGE_VENDOR || 1),
    region: Number(process.env.AGORA_STORAGE_REGION || 0),
    bucket: process.env.AGORA_STORAGE_BUCKET,
    accessKey: process.env.AGORA_STORAGE_KEY,
    secretKey: process.env.AGORA_STORAGE_SECRET,
    fileNamePrefix: ["yogamitra", "recordings"],
  };
}

/* Reserve a recording resource for a channel. Returns resourceId. */
async function acquireRecording(channelName, recordUid) {
  if (!isRecordingConfigured()) {
    throw new Error("Cloud recording is not configured");
  }
  const { data } = await axios.post(
    `${recBase()}/acquire`,
    {
      cname: channelName,
      uid: String(recordUid),
      clientRequest: { resourceExpiredHour: 24, scene: 0 },
    },
    { headers: { Authorization: recordingAuthHeader() } },
  );
  return data.resourceId;
}

/* Start recording. Returns { resourceId, sid }. */
async function startRecording(channelName, recordUid, resourceId, token = "") {
  const { data } = await axios.post(
    `${recBase()}/resourceid/${resourceId}/mode/mix/start`,
    {
      cname: channelName,
      uid: String(recordUid),
      clientRequest: {
        token: token || undefined,
        recordingConfig: {
          channelType: 1, // live broadcast
          streamTypes: 2, // audio + video
          videoStreamType: 0,
          maxIdleTime: 30,
          transcodingConfig: {
            width: 720,
            height: 1280,
            fps: 15,
            bitrate: 1500,
            mixedVideoLayout: 1,
          },
        },
        recordingFileConfig: { avFileType: ["hls", "mp4"] },
        storageConfig: storageConfig(),
      },
    },
    { headers: { Authorization: recordingAuthHeader() } },
  );
  return { resourceId, sid: data.sid };
}

/* Stop recording. Returns the server response (includes fileList). */
async function stopRecording(channelName, recordUid, resourceId, sid) {
  const { data } = await axios.post(
    `${recBase()}/resourceid/${resourceId}/sid/${sid}/mode/mix/stop`,
    {
      cname: channelName,
      uid: String(recordUid),
      clientRequest: {},
    },
    { headers: { Authorization: recordingAuthHeader() } },
  );
  return data;
}

module.exports = {
  APP_ID,
  isTokenConfigured,
  isRecordingConfigured,
  buildRtcToken,
  acquireRecording,
  startRecording,
  stopRecording,
};
