#!/usr/bin/env bash
set -e

AI_DIR="$HOME/koboldcpp"
MODEL_DIR="$AI_DIR/models"
mkdir -p "$MODEL_DIR"

echo "========================================================================="
echo " [Trade Journal AI] Official bartowski / unsloth Qwen 3.8 Setup"
echo " Hardware: RTX 4070 Super (12GB VRAM) + 64GB System RAM"
echo "========================================================================="

# 1. Download Latest KoboldCpp CUDA Binary if not present
if [ ! -f "$AI_DIR/koboldcpp" ]; then
    echo "[1/3] Downloading latest KoboldCpp CUDA binary..."
    curl -fL "https://github.com/LostRuins/koboldcpp/releases/latest/download/koboldcpp-linux-x64-cuda1210" -o "$AI_DIR/koboldcpp" || \
    curl -fL "https://github.com/LostRuins/koboldcpp/releases/latest/download/koboldcpp-linux-x64" -o "$AI_DIR/koboldcpp"
    chmod +x "$AI_DIR/koboldcpp"
else
    echo "[1/3] KoboldCpp binary ready at $AI_DIR/koboldcpp"
fi

# 2. Select Quantization Tier from bartowski / unsloth
echo ""
echo "Select Model & Quantization from verified community uploaders:"
echo "  1) bartowski: Qwen3.8-27B-Q4_K_M (17.4 GB) [RECOMMENDED - 99.2% FP16 accuracy]"
echo "     -> 42 layers in 12GB VRAM + ~6.9 GB in RAM. 32K context with Flash Attention."
echo "  2) bartowski: Qwen3.8-27B-Q5_K_M (19.8 GB) [Near-Lossless 99.8% accuracy]"
echo "     -> 38 layers in 12GB VRAM + ~9.5 GB in RAM."
echo "  3) unsloth: Qwen3.8-27B-UD-Q4_K_XL (17.6 GB) [Dynamic v3.0 imatrix]"
echo "     -> Preserves linear attention weights at higher bitrates."
echo "  4) bartowski: DeepSeek-R1-Distill-Qwen-32B-Q4_K_M (19.8 GB) [Alternative Deep Reasoner]"
echo "     -> 36 layers in 12GB VRAM + ~9.8 GB in RAM."
read -rp "Select [1/2/3/4] (default 1): " CHOICE
CHOICE="${CHOICE:-1}"

case "$CHOICE" in
    2)
        REPO="bartowski/Qwen3.8-27B-GGUF"
        FILE="Qwen3.8-27B-Q5_K_M.gguf"
        GPU_LAYERS=38
        ;;
    3)
        REPO="unsloth/Qwen3.8-27B-GGUF"
        FILE="Qwen3.8-27B-UD-Q4_K_XL.gguf"
        GPU_LAYERS=42
        ;;
    4)
        REPO="bartowski/DeepSeek-R1-Distill-Qwen-32B-GGUF"
        FILE="DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf"
        GPU_LAYERS=36
        ;;
    *)
        REPO="bartowski/Qwen3.8-27B-GGUF"
        FILE="Qwen3.8-27B-Q4_K_M.gguf"
        GPU_LAYERS=42
        ;;
esac

MODEL_PATH="$MODEL_DIR/$FILE"
DOWNLOAD_URL="https://huggingface.co/${REPO}/resolve/main/${FILE}"

echo ""
echo "[2/3] Downloading ${FILE} from https://huggingface.co/${REPO}..."
echo "Destination: $MODEL_PATH"
curl -L -C - --progress-bar "$DOWNLOAD_URL" -o "$MODEL_PATH"

# 3. Create Optimized Startup Launcher (Port 5001, 32K Context, Flash Attention, 8-bit KV Cache)
cat << LAUNCH > "$AI_DIR/start-kobold.sh"
#!/usr/bin/env bash
MODEL="$MODEL_PATH"
PORT=5001
NGL=$GPU_LAYERS
CTX=32768

echo "========================================================================="
echo " Starting Local AI Server on 0.0.0.0:\$PORT"
echo " Model:   \$(basename "\$MODEL")"
echo " Context: \$CTX tokens (Flash Attention + 8-bit KV Cache)"
echo " Offload: \$NGL layers in RTX 4070 Super VRAM | Remainder in 64GB RAM"
echo "========================================================================="

# Try KoboldCpp; fall back to llama-server if available
"$AI_DIR/koboldcpp" \\
  --model "\$MODEL" \\
  --host 0.0.0.0 \\
  --port \$PORT \\
  --usecublas \\
  --gpulayers \$NGL \\
  --contextsize \$CTX \\
  --flashattention \\
  --quantkv 1 \\
  --contextshift \\
  --skiplauncher || {
    echo "[!] KoboldCpp returned error. Falling back to llama-server..."
    if command -v llama-server >/dev/null 2>&1; then
      exec llama-server \\
        -m "\$MODEL" \\
        --host 0.0.0.0 \\
        --port \$PORT \\
        -ngl \$NGL \\
        -c \$CTX \\
        --flash-attn on \\
        -ctk q8_0 -ctv q8_0
    fi
  }
LAUNCH
chmod +x "$AI_DIR/start-kobold.sh"

echo ""
echo "=== [3/3] Setup Complete! ==="
echo "Run this command on your desktop to start the local AI server:"
echo "  ~/koboldcpp/start-kobold.sh"
