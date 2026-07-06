Perfecto: primero te doy un **boilerplate básico de backend FastAPI + PostGIS** para que tu equipo arranque en 10 minutos, y luego te explico con claridad **la diferencia entre este boilerplate y el SRS**.

***

## 1. Boilerplate: Backend vial unificado (FastAPI + PostGIS)

Este es un **esqueleto mínimo** para que tu API vial pueda:

- Recibir solicitudes desde el frontend HTML.  
- Consultar una tabla `vias_unificadas` con geometrías en PostGIS.  
- Devolver GeoJSON ligero optimizado para mapas.

### Estructura de proyecto recomendada

```bash
vial-api/
├── main.py          # FastAPI app
├── models.py        # SQLAlchemy + GeoAlchemy2
├── schemas.py       # Pydantic (DTOs)
├── database.py      # Config DB + session
├── endpoints/
│   └── vias.py      # Rutas /vias/...
└── .env             # DB config
```

### 1.1 `database.py` – conexión PostGIS

```python
# database.py
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = "postgresql://usuario:clave@localhost:5432/vial_db"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
```

### 1.2 `models.py` – tabla vial con geometría

```python
# models.py
from sqlalchemy import Column, Integer, String, Numeric, JSON
from geoalchemy2.types import Geometry
from database import Base

class ViasUnificadas(Base):
    __tablename__ = "vias_unificadas"

    id_vial = Column(Integer, primary_key=True, index=True)
    codigo_vial = Column(String, index=True)
    nombre_tramo = Column(String)
    tipo_vial = Column(String)        # 'nacional', 'departamental', etc.
    estado_vial = Column(String)      # 'bueno', 'regular', 'malo'
    pavimentada = Column(Integer)     # 0/1
    longitud_km = Column(Numeric(10, 2))
    geom = Column(Geometry("MULTILINESTRING", srid=4326))
    fuente = Column(String)           # ej: datos.gov.co, invias_arcgis
    fecha_actualizacion = Column(String)
    extra_attributes = Column(JSON)   # atributos extra de cada fuente
```

### 1.3 `schemas.py` – DTOs Pydantic

```python
# schemas.py
from pydantic import BaseModel, Field
from typing import Optional, Any

class ViasResponse(BaseModel):
    id_vial: int
    codigo_vial: Optional[str]
    nombre_tramo: Optional[str]
    tipo_vial: Optional[str]
    estado_vial: Optional[str]
    pavimentada: Optional[bool]
    longitud_km: Optional[float]
    fuente: Optional[str]
    extra_attributes: Optional[Any] = Field(default_factory=dict)
    geometry: dict  # GeoJSON

class SearchResponse(BaseModel):
    type: str = "FeatureCollection"
    features: list[ViasResponse]
```

### 1.4 `endpoints/vias.py` – endpoints de consulta rápida

```python
# endpoints/vias.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from database import SessionLocal, ViasUnificadas

router = APIRouter(prefix="/vias", tags=["vías"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.get("/region", response_model=SearchResponse)
def get_vias_region(
    depto: str = Query(None),
    bbox: Optional[str] = Query(None),  # "left,bottom,right,top"
    limit: int = 1000,
    db: Session = Depends(get_db),
):
    """
    Devuelve vías dentro de un departamento o bbox, con límite para evitar saturar el frontend.
    """
    # Ejemplo: filtro por depto y bbox
    query = db.query(ViasUnificadas)

    if depto:
        query = query.filter(ViasUnificadas.extra_attributes["departamento"].astext == depto)

    if bbox:
        left, bottom, right, top = map(float, bbox.split(","))
        query = query.filter(
            ViasUnificadas.geom.ST_Intersects(
                f"ST_MakeEnvelope({left}, {bottom}, {right}, {top}, 4326)"
            )
        )

    results = query.limit(limit).all()

    # Convertir geometría a GeoJSON
    features = []
    for row in results:
        feature = {
            "type": "Feature",
            "properties": {
                "id_vial": row.id_vial,
                "codigo_vial": row.codigo_vial,
                "nombre_tramo": row.nombre_tramo,
                "tipo_vial": row.tipo_vial,
                "estado_vial": row.estado_vial,
                "pavimentada": bool(row.pavimentada) if row.pavimentada is not None else None,
                "longitud_km": row.longitud_km,
                "fuente": row.fuente,
                "extra_attributes": row.extra_attributes,
            },
            "geometry": eval(row.geom.ST_AsGeoJSON()),  # PostgreSQL -> GeoJSON
        }
        features.append(feature)

    return {"type": "FeatureCollection", "features": features}
```

### 1.5 `main.py` – app FastAPI principal

```python
# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import Base, engine
from models import ViasUnificadas
from endpoints.vias import router

app = FastAPI(title="API Vial Unificada", description="Backend para visualizar vías colombianas.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Ajusta en produccion
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)

app.include_router(router)
```
