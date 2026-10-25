"""Tiny ElevenLabs helper; the key is read from SSM at runtime, never written to disk."""
import json, sys, urllib.request, boto3

def key():
    raw = boto3.Session(profile_name="servikaki-secrets", region_name="eu-west-1").client("ssm").get_parameter(
        Name="/servikaki/secrets/elevenlabs.env", WithDecryption=True)["Parameter"]["Value"]
    return next(l.split("=", 1)[1].strip().strip('"') for l in raw.splitlines() if l.startswith("ELEVENLABS_API_KEY="))

def call(path, body=None, method=None, query=""):
    req = urllib.request.Request(f"https://api.elevenlabs.io{path}{query}", data=json.dumps(body).encode() if body else None,
                                 method=method or ("POST" if body else "GET"),
                                 headers={"xi-api-key": key(), "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()

if __name__ == "__main__" and sys.argv[1] == "voices":
    d = json.loads(call("/v2/voices?page_size=100"))
    for v in d["voices"]:
        l = v.get("labels", {})
        if l.get("gender") == "female":
            print(v["voice_id"], "|", v["name"][:40], "|", l.get("accent"), l.get("age"), l.get("descriptive") or l.get("description"), l.get("use_case"))
    sub = json.loads(call("/v1/user/subscription"))
    print("\nplan:", sub.get("tier"), "| chars used:", sub.get("character_count"), "/", sub.get("character_limit"))
