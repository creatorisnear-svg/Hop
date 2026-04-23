FROM ollama/ollama:latest

# Which Qwen model to preload. Override with --build-arg MODEL=qwen2.5:0.5b
# Recommended models for free / small Koyeb instances:
#   qwen2.5:0.5b-instruct  (~400MB,  fits 512MB RAM, fastest)
#   qwen2.5:1.5b-instruct  (~1GB,   fits 1GB+ RAM, better quality)
#   qwen2.5:3b-instruct    (~2GB,   needs 4GB instance)
ARG MODEL=qwen2.5:1.5b-instruct
ENV MODEL=${MODEL}
ENV OLLAMA_HOST=0.0.0.0:8080
ENV OLLAMA_KEEP_ALIVE=24h
ENV OLLAMA_NUM_PARALLEL=1

# Preload the model into the image so cold starts are fast
RUN bash -c "ollama serve & sleep 5 && ollama pull ${MODEL} && pkill ollama"

EXPOSE 8080

ENTRYPOINT ["/bin/ollama"]
CMD ["serve"]
