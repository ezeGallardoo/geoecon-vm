FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgeos-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Chromium para el comando `maps`. --with-deps trae las libs de sistema
# (libnss3, libatk, etc.) que el navegador headless necesita.
RUN playwright install --with-deps chromium

COPY geoecon ./geoecon

ENTRYPOINT ["python", "-m", "geoecon"]
CMD ["--help"]
