# Bridge Aranter (chat analis + live feed bot) + Antigravity CLI (agy) untuk analisa AI.
# agy berjalan DI DALAM container ini (terisolasi dari file server).
# Login: akun Google (OAuth) sekali lewat `docker exec -it aranter_bridge agy`; data login disimpan di
# volume agy_home (/root) sehingga tetap ada walau image di-build ulang.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Antigravity CLI resmi (dokumentasi: antigravity.google/docs/getting-started?tab=cli)
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash \
    && cp /root/.local/bin/agy /usr/local/bin/agy && agy --version
WORKDIR /app
COPY analyst_bridge.py prompt_template.md chat_template.md ./
ENV PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 PORT=8787 HOST=0.0.0.0
EXPOSE 8787
CMD ["python", "analyst_bridge.py"]
