from fastapi import FastAPI, Query
from typing import Optional

app = FastAPI()


@app.get("/")
async def root():
    return {"message": "Hello from FastAPI server!"}


@app.get("/items")
async def get_items(
    name: Optional[str] = Query(None, description="Filter by item name"),
    category: Optional[str] = Query(None, description="Filter by category"),
    limit: int = Query(10, ge=1, le=100, description="Maximum number of items to return")
):
    """
    Get a list of items with optional filtering.
    
    - **name**: Filter items by name (optional)
    - **category**: Filter items by category (optional)
    - **limit**: Maximum number of items to return (1-100, default: 10)
    """
    items = [
        {"id": 1, "name": "Item One", "category": "electronics"},
        {"id": 2, "name": "Item Two", "category": "books"},
        {"id": 3, "name": "Item Three", "category": "electronics"},
        {"id": 4, "name": "Item Four", "category": "clothing"},
        {"id": 5, "name": "Item Five", "category": "books"},
    ]
    
    if name:
        items = [item for item in items if name.lower() in item["name"].lower()]
    if category:
        items = [item for item in items if item["category"] == category.lower()]
    
    return {"items": items[:limit], "total": len(items[:limit])}