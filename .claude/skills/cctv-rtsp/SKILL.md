---
name: cctv-rtsp
description: Configure or integrate CCTV cameras and RTSP streams with the shop system, including connection handling, snapshots, health monitoring, or stream troubleshooting. Use whenever camera, RTSP, NVR, or video-event integration is requested.
---

# CCTV and RTSP

Treat camera video as sensitive data. Prefer metadata and health checks over
retaining video when that meets the requirement.

## Workflow

1. Confirm camera/NVR model, firmware, stream transport and codec, network
   location, intended purpose, authorized access, and retention requirements.
2. Inspect vendor documentation and test a minimal read-only connection before
   building integration logic.
3. Keep URLs and credentials in local secret configuration. Redact userinfo,
   tokens, query parameters, and sensitive paths from logs and error messages.
4. Bound connection timeouts, retries, decoder resources, and any temporary
   buffers. Reconnect safely and surface unavailable streams as explicit health
   states.
5. Avoid storing frames or clips unless explicitly required. If storage is
   required, define access control, encryption, retention, and deletion.
6. Keep camera identity and timestamps in a separate event boundary; do not
   silently join footage to RFID/customer records.

## Privacy and limits

- Verify applicable notice, consent, access, and retention requirements before
  enabling recording or analytics.
- Do not add face recognition or individual tracking by implication.
- A camera observation and an RFID read are separate evidence sources; neither
  alone establishes theft or intent.
- Test with authorized cameras and non-sensitive sample footage where possible.
