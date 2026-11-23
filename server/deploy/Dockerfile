# Bridge Aranter (chat analis + live feed bot). Hanya library standar Python.
FROM python:3.12-slim
WORKDIR /app
COPY analyst_bridge.py prompt_template.md chat_template.md ./
ENV PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 PORT=8787
EXPOSE 8787
CMD ["python", "analyst_bridge.py"]
