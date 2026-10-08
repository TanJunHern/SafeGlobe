import os
import re
import json
import sqlite3
import requests
from typing import List, Optional
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from dotenv import load_dotenv, find_dotenv

# Load environment variables
load_dotenv(find_dotenv())

# ----------------------------------------------------
# 1. Models & Schemas
# ----------------------------------------------------
class CountryCpiRecord(BaseModel):
    country: str = Field(description="Full country or territory name")
    iso3: str = Field(description="3-letter ISO code, e.g. SGP, DNK, SOM")
    score: int = Field(description="CPI 2025 score between 0 (highly corrupt) and 100 (very clean)")
    rank: int = Field(description="CPI 2025 rank out of 182")
    region: Optional[str] = Field(default=None, description="Regional code e.g. AP, WE/EU, SSA, AME, ECA, MENA")

class CpiExtractionReport(BaseModel):
    source_url: str = Field(default="https://www.transparency.org/en/cpi/2025")
    year: int = Field(default=2025)
    total_countries: int = Field(default=0)
    color_scheme: dict = Field(
        default_factory=lambda: {
            "scale_type": "continuous_gradient_and_brackets",
            "brackets": [
                {"from": 0, "to": 9, "hex": "#78201b"},
                {"from": 10, "to": 19, "hex": "#a22922"},
                {"from": 20, "to": 29, "hex": "#d2372b"},
                {"from": 30, "to": 39, "hex": "#e0452b"},
                {"from": 40, "to": 49, "hex": "#e3612b"},
                {"from": 50, "to": 59, "hex": "#e5762e"},
                {"from": 60, "to": 69, "hex": "#e99235"},
                {"from": 70, "to": 79, "hex": "#edae3d"},
                {"from": 80, "to": 89, "hex": "#f2ca45"},
                {"from": 90, "to": 100, "hex": "#f9e74e"}
            ],
            "gradient_stops": [
                "#86170b", "#8a160b", "#96150c", "#aa120e", "#ae120e", 
                "#b2110e", "#bd0f0f", "#cf0b11", "#d90912", "#da0c12", 
                "#dd1612", "#e22612", "#e63312", "#e73811", "#e8470e", 
                "#eb6009", "#eb6209", "#ec6a06", "#ef7d00", "#f59c00", 
                "#f9b100", "#fbba00", "#fdc700", "#fed200", "#ffd500", 
                "#ffd600", "#ffe300", "#ffeb00", "#ffed00"
            ]
        }
    )
    records: List[CountryCpiRecord] = Field(default_factory=list)

# ----------------------------------------------------
# 2. Fetch CPI Data
# ----------------------------------------------------
def fetch_cpi_2025_data() -> List[CountryCpiRecord]:
    # 1. Fetch via official Transparency API endpoint embedded in the CPI web application
    api_url = "https://www.transparency.org/en/api/latest/cpi"
    try:
        try:
            from curl_cffi import requests as cffi_requests
            resp = cffi_requests.get(api_url, impersonate="chrome124", timeout=25)
        except ImportError:
            resp = requests.get(api_url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            }, timeout=25)

        if resp.status_code == 200:
            raw_data = resp.json()
            records_2025 = []
            for item in raw_data:
                if item.get("year") == 2025:
                    records_2025.append(CountryCpiRecord(
                        country=str(item.get("country", "")).strip(),
                        iso3=str(item.get("iso3", "")).strip().upper(),
                        score=int(item.get("score", 0)),
                        rank=int(item.get("rank", 0)),
                        region=item.get("region")
                    ))
            if len(records_2025) >= 150:
                print(f"[+] Fetched all {len(records_2025)} countries directly from Transparency API")
                return sorted(records_2025, key=lambda r: (r.rank, -r.score))
    except Exception as e:
        print(f"[-] Direct API fetch error ({e}), trying web page scrape...")

    # 2. Web Scrape & LLM fallback
    web_url = "https://www.transparency.org/en/cpi/2025"
    try:
        from curl_cffi import requests as cffi_requests
        response = cffi_requests.get(web_url, impersonate="chrome124", timeout=25)
    except ImportError:
        response = requests.get(web_url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }, timeout=25)
    soup = BeautifulSoup(response.text, "html.parser")
    for el in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        el.extract()
    text = soup.get_text(separator="\n")[:30000]

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("Missing GEMINI_API_KEY or GOOGLE_API_KEY.")

    class SimpleCpiList(BaseModel):
        items: List[CountryCpiRecord] = Field(default_factory=list)

    client = genai.Client(api_key=api_key)
    prompt = f"""
    Extract the Transparency International CPI 2025 rankings and country scores from the text.
    Return country name, 3-letter ISO code (iso3), CPI 2025 score (0-100), and rank.
    
    Webpage Content:
    {text}
    """
    ai_resp = client.models.generate_content(
        model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=SimpleCpiList,
            temperature=0.0
        )
    )
    parsed = SimpleCpiList.model_validate_json(ai_resp.text)
    return parsed.items

# ----------------------------------------------------
# 3. Store in Database & JSON
# ----------------------------------------------------
def save_cpi_to_database(records: List[CountryCpiRecord]):
    db_candidates = [
        os.path.join(os.path.dirname(__file__), "..", "data", "safe_globe.db"),
        os.path.join(os.path.dirname(__file__), "data", "safe_globe.db"),
        os.path.abspath("data/safe_globe.db")
    ]
    target_db = None
    for cand in db_candidates:
        if os.path.exists(cand) or os.path.exists(os.path.dirname(cand)):
            target_db = os.path.abspath(cand)
            break
    if not target_db:
        return

    os.makedirs(os.path.dirname(target_db), exist_ok=True)
    conn = sqlite3.connect(target_db)
    cur = conn.cursor()
    cur.execute("""
      CREATE TABLE IF NOT EXISTS cpi (
        a3 TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        score INTEGER NOT NULL,
        rank INTEGER NOT NULL
      )
    """)
    for r in records:
        cur.execute("""
          INSERT OR REPLACE INTO cpi (a3, name, score, rank)
          VALUES (?, ?, ?, ?)
        """, (r.iso3.upper(), r.country, r.score, r.rank))
    conn.commit()
    conn.close()
    print(f"[+] Saved {len(records)} CPI 2025 countries into SQLite DB: {target_db}")

def run():
    print("[*] Reading Transparency International CPI 2025...")
    records = fetch_cpi_2025_data()
    report = CpiExtractionReport(
        source_url="https://www.transparency.org/en/cpi/2025",
        year=2025,
        total_countries=len(records),
        records=records
    )

    # 1. Save to SQLite Database
    save_cpi_to_database(records)

    # 2. Save JSON artifacts
    json_paths = [
        os.path.join(os.path.dirname(__file__), "cpi_2025_data.json"),
        os.path.join(os.path.dirname(__file__), "..", "cpi_2025_data.json")
    ]
    for p in json_paths:
        try:
            with open(p, "w", encoding="utf-8") as f:
                json.dump(report.model_dump(), f, indent=2)
            print(f"[+] Saved CPI report to {p}")
        except Exception as e:
            print(f"[-] Error writing to {p}: {e}")

    print(f"[+] Successfully processed CPI 2025: {len(records)} jurisdictions loaded.")

if __name__ == "__main__":
    run()
