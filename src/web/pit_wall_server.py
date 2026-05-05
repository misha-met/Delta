import argparse
import asyncio
import hashlib
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.web.session_manager import SessionManager, loading_state
from src.web.ws_hub import WSHub
from src.web.playback import Playback, build_snapshot
from src.web.http_routes import register_http
from src.web.ws_routes import register_ws


def build_app(year, round_number, session_type: str, cache_dir: Path) -> FastAPI:
    session_mgr = SessionManager(cache_dir=cache_dir)
    ws_hub = WSHub()
    playback = Playback(session_mgr, ws_hub)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Startup: only kick off a session load if a year+round were passed
        # explicitly. With no preselection the frontend RacePicker handles
        # session selection via POST /api/session/load.
        if year is not None and round_number is not None:
            loop = asyncio.get_event_loop()
            loop.run_in_executor(None, session_mgr.load, year, round_number, session_type)
        await playback.start()
        yield
        # Shutdown
        await playback.stop()

    app = FastAPI(lifespan=lifespan)
    app.state.session_mgr = session_mgr
    app.state.ws_hub = ws_hub
    app.state.playback = playback

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:8000",
            "http://127.0.0.1:8000",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_http(app)
    register_ws(app)

    # Disable HTTP caching for frontend assets so browser reloads always pick up
    # the newest bundle after rebuilds/restarts.
    @app.middleware("http")
    async def _disable_frontend_cache(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/app/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

    # Serve the React frontend at /app/Pit%20Wall.html
    project_dir = Path(__file__).resolve().parent.parent.parent / "project"
    if project_dir.is_dir():
        bundle_path = project_dir / "dist" / "bundle.js"
        if not bundle_path.is_file():
            raise SystemExit(
                "\n"
                "  ╔══════════════════════════════════════════════════════════════╗\n"
                "  ║  ERROR: frontend bundle is missing.                          ║\n"
                "  ║                                                              ║\n"
                f"  ║  Expected: {str(bundle_path):<50}║\n"
                "  ║                                                              ║\n"
                "  ║  Build it with:                                              ║\n"
                "  ║      cd project && npm install && npm run build              ║\n"
                "  ║                                                              ║\n"
                "  ║  On Windows, if npm run build fails, antivirus may be        ║\n"
                "  ║  blocking esbuild. Allowlist project\\node_modules\\@esbuild   ║\n"
                "  ║  or use the scripts\\start.bat helper.                        ║\n"
                "  ╚══════════════════════════════════════════════════════════════╝\n"
            )
        try:
            bundle_sig = hashlib.md5(bundle_path.read_bytes()).hexdigest()[:12]
        except Exception:
            bundle_sig = "unreadable"
        app.mount("/app", StaticFiles(directory=str(project_dir), html=True), name="app")
        print(f"[pit_wall] bundle {bundle_sig}  static -> {project_dir}")

    # Snapshot provider for WS hub — sends full state on connect
    def _snapshot():
        loaded = session_mgr.current()
        state = loading_state()
        if loaded is None:
            return {"type": "loading", **state}
        return build_snapshot(loaded, playback)

    ws_hub.set_snapshot_provider(_snapshot)

    return app


def main():
    p = argparse.ArgumentParser()
    # --year/--round are optional. When omitted, no session is loaded at
    # startup and the RacePicker UI is shown when the browser connects.
    p.add_argument("--year", type=int, default=None)
    p.add_argument("--round", dest="round_number", type=int, default=None)
    p.add_argument("--session-type", default="R")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--cache-dir", type=Path, default=Path("cache/fastf1"))
    args = p.parse_args()
    app = build_app(args.year, args.round_number, args.session_type, args.cache_dir)

    url = f"http://{args.host}:{args.port}/app/Pit%20Wall.html"
    print()
    print("  ╔══════════════════════════════════════════════════════╗")
    print("  ║           Delta Pitwall — server starting            ║")
    print("  ╠══════════════════════════════════════════════════════╣")
    print(f"  ║  Open: {url:<45} ║")
    print("  ║  Stop: Ctrl+C                                        ║")
    print("  ╚══════════════════════════════════════════════════════╝")
    print()

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        ws_max_size=32 * 1024 * 1024,
        ws_per_message_deflate=True,
        ws_ping_interval=20.0,
        ws_ping_timeout=20.0,
        ws_max_queue=64,
    )


if __name__ == "__main__":
    main()
