FROM python:3.13-alpine

# uv en lugar de pip. Copiamos el binario de la imagen oficial, con la misma versión que el host.
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /uvx /bin/

RUN apk add --no-cache docker-cli && uv pip install --system --no-cache "flask==3.1.*"
WORKDIR /app
COPY app.py .
COPY static static
EXPOSE 8090
CMD ["python", "-u", "app.py"]
