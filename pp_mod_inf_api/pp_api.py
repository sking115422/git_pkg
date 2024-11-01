from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from pydantic import BaseModel
from PIL import Image
import io
import cv2
import os
import numpy as np
import json

from pp_inf import pp_inference
from utils import generate_random_string, get_current_timestamp, sterilize_url

app = FastAPI()

@app.post("/infer")
async def infer(image: UploadFile = File(...), url: str = Form(...)):
    if image is None or url is None:
        raise HTTPException(status_code=400, detail="Image or url missing")
    
    og_img_dir = './og_img'
    if not os.path.exists(og_img_dir):
        os.makedirs(og_img_dir)
        
    json_dir = './json'
    if not os.path.exists(json_dir):
        os.makedirs(json_dir)
        
    og_img_outpath = os.path.join(og_img_dir, f'{sterilize_url(url)}_{get_current_timestamp()}.png')
    json_outpath = os.path.join(json_dir, f'{sterilize_url(url)}_{get_current_timestamp()}.json')
    
    image_file = await image.read()
    image_np = np.frombuffer(image_file, np.uint8)
    img = cv2.imdecode(image_np, cv2.IMREAD_COLOR)
    
    output = pp_inference(img, url)
    
    cv2.imwrite(og_img_outpath, img)
    with open(json_outpath, 'w') as json_file:
        json.dump(output, json_file, indent=4)

    return output

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=5000)
