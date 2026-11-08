FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY load_generator.py run_experiment.py ./
ENV PYTHONUNBUFFERED=1
ENTRYPOINT ["python", "run_experiment.py"]
