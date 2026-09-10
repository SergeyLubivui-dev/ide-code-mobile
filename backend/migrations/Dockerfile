FROM python:3.11-slim
WORKDIR /migrations
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENTRYPOINT ["alembic"]
CMD ["upgrade", "head"]
