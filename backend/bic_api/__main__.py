"""Start on loopback; an operator supplies the HTTPS reverse proxy separately."""

import os

import uvicorn


if __name__ == '__main__':
    try:
        port = int(os.environ.get('BIC_PORT', '9001'))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise SystemExit('BIC_PORT must be an integer between 1 and 65535.') from None
    uvicorn.run('backend.bic_api.app:app_from_env', factory=True, host='127.0.0.1', port=port,
                proxy_headers=False, workers=1)
