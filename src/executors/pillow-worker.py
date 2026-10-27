# Fixed conventional PNG worker. No template code, subprocess, shell, network or arbitrary paths.
import hashlib, json, os, sys, time, warnings, zlib, io
from pathlib import Path
from PIL import Image, ImageOps, __version__ as pillow_version
Image.MAX_IMAGE_PIXELS = 16000000
warnings.simplefilter("error", Image.DecompressionBombWarning)
def sha(b): return hashlib.sha256(b).hexdigest()
def load(name, expected):
    raw = Path(name).read_bytes()
    if len(raw) > 24 * 1024 * 1024 or sha(raw) != expected["sha256"]: raise ValueError("INPUT_HASH_MISMATCH")
    with Image.open(io.BytesIO(raw)) as im:
        if im.format != "PNG" or getattr(im, "n_frames", 1) != 1 or im.size != (expected["width"], expected["height"]): raise ValueError("INPUT_FORMAT_MISMATCH")
        im.load()
        return im.convert("RGBA")
command = json.loads(Path("command.json").read_text("utf-8"))
r = command["recipe"]
started = time.time()
scene = load("scene.png", r["scene"])
c = r["crop"]
scene = scene.crop((c["x"], c["y"], c["x"]+c["width"], c["y"]+c["height"]))
o = r["output"]
# Aspect ratio is preserved; padding is explicit and channel-independent.
scene = ImageOps.contain(scene, (o["width"], o["height"]), Image.Resampling.LANCZOS)
output = Image.new("RGBA", (o["width"], o["height"]), tuple(o["background"]))
output.alpha_composite(scene, ((o["width"]-scene.width)//2, (o["height"]-scene.height)//2))
if r["logo"] is not None:
    logo = load("logo.png", r["logo"])
    p = r["placement"]
    logo = logo.resize((p["width"], p["height"]), Image.Resampling.LANCZOS)
    logo.putalpha(logo.getchannel("A").point(lambda x: round(x*p["opacity"])))
    output.alpha_composite(logo, (p["x"], p["y"]))
if Path("output.png").exists() or Path("receipt.json").exists(): raise ValueError("OUTPUT_ALREADY_EXISTS")
output.save("output.partial.png", format="PNG", compress_level=9, optimize=False)
raw = Path("output.partial.png").read_bytes()
if len(raw) > 24*1024*1024: raise ValueError("OUTPUT_TOO_LARGE")
with open("output.partial.png", "r+b") as f: os.fsync(f.fileno())
os.replace("output.partial.png", "output.png")
receipt = {"assignmentId":command["assignmentId"],"attemptId":command["attemptId"],"recipeHash":command["recipeHash"],
           "inputHashes":[r["scene"]["sha256"]]+([r["logo"]["sha256"]] if r["logo"] else []),
           "outputSha256":sha(raw),"width":output.width,"height":output.height,
           "tool":"Pillow","version":pillow_version,"python":sys.version.split()[0],"zlib":zlib.ZLIB_VERSION,
           "startedAt":started,"finishedAt":time.time(),"exitCode":0,"profile":o}
with open("receipt.partial.json","x",encoding="utf-8") as f:
    json.dump(receipt,f,sort_keys=True);f.flush();os.fsync(f.fileno())
os.replace("receipt.partial.json","receipt.json")
print(json.dumps({"sha256":receipt["outputSha256"],"bytes":len(raw)}))
