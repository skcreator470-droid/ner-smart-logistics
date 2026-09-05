import os
import requests
from dotenv import load_dotenv

load_dotenv()

client_id = os.getenv("COPERNICUS_CLIENT_ID")
client_secret = os.getenv("COPERNICUS_CLIENT_SECRET")

if not client_id or not client_secret:
    raise RuntimeError("Copernicus credentials are missing from .env")

token_url = (
    "https://identity.dataspace.copernicus.eu/"
    "auth/realms/CDSE/protocol/openid-connect/token"
)

response = requests.post(
    token_url,
    data={
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    },
    timeout=30,
)

print("HTTP status:", response.status_code)

if response.ok:
    data = response.json()
    print("Copernicus authentication: SUCCESS")
    print("Token received:", bool(data.get("access_token")))
else:
    print("Copernicus authentication: FAILED")
    print(response.text)