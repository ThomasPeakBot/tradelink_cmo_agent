FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 CSO_SOURCE_REPOSITORY=ThomasPeakBot/tradelink_cmo_agent
WORKDIR /app
COPY cso_receiver/ /app/
RUN python -m unittest -v test_receiver && useradd --system --uid 10001 receiver
USER receiver
CMD ["python","receiver.py"]
