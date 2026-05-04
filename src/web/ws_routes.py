from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from src.web.ws_hub import WSHub


def register_ws(app: FastAPI):
    @app.websocket("/ws/telemetry")
    async def ws_telemetry(ws: WebSocket):
        hub: WSHub = app.state.ws_hub
        await hub.connect(ws)
        try:
            while True:
                # Keep connection alive; we push from Playback, not from client messages
                await ws.receive_text()
        except WebSocketDisconnect:
            hub.disconnect(ws)
        except Exception:
            hub.disconnect(ws)
