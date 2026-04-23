import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
} from "firebase/auth";
import { auth } from "./firebase";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const oobCode = useMemo(() => searchParams.get("oobCode") || "", [searchParams]);
  const mode = useMemo(() => searchParams.get("mode") || "", [searchParams]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [validCode, setValidCode] = useState(false);
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    async function validateCode() {
      try {
        setLoading(true);
        setError("");
        setSuccess("");

        if (!oobCode || mode !== "resetPassword") {
          setValidCode(false);
          setError("Link inválido ou incompleto.");
          return;
        }

        const userEmail = await verifyPasswordResetCode(auth, oobCode);
        setEmail(userEmail);
        setValidCode(true);
      } catch (err) {
        console.error("Erro ao validar código:", err);
        setValidCode(false);
        setError("Este link de redefinição é inválido ou expirou.");
      } finally {
        setLoading(false);
      }
    }

    validateCode();
  }, [oobCode, mode]);

  async function handleSubmit(e) {
    e.preventDefault();

    try {
      setError("");
      setSuccess("");

      if (!newPassword || !confirmPassword) {
        setError("Preencha os dois campos de senha.");
        return;
      }

      if (newPassword.length < 6) {
        setError("A nova senha deve ter pelo menos 6 caracteres.");
        return;
      }

      if (newPassword !== confirmPassword) {
        setError("As senhas não coincidem.");
        return;
      }

      setSubmitting(true);

      await confirmPasswordReset(auth, oobCode, newPassword);

      setSuccess("Senha redefinida com sucesso! Você já pode entrar no app.");

      setTimeout(() => {
        navigate("/");
      }, 1800);
    } catch (err) {
      console.error("Erro ao redefinir senha:", err);
      setError("Não foi possível redefinir a senha. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  const pageStyle = {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #0f1020 0%, #121212 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    color: "#fff",
    fontFamily: "Inter, system-ui, sans-serif",
  };

  const cardStyle = {
    width: "100%",
    maxWidth: 460,
    borderRadius: 24,
    padding: 24,
    background: "linear-gradient(135deg, #1e1e1e, #121212)",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
  };

  const inputStyle = {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "#1c1c1f",
    color: "#fff",
    fontSize: 16,
    outline: "none",
    boxSizing: "border-box",
  };

  const buttonStyle = {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 16,
    border: "none",
    background: "linear-gradient(135deg, #7C5CFF, #5A8BFF)",
    color: "#fff",
    fontSize: 16,
    fontWeight: 800,
    cursor: submitting ? "not-allowed" : "pointer",
    opacity: submitting ? 0.7 : 1,
  };

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <img
            src="/logo-192.png"
            alt="Repetra"
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: "#000",
              objectFit: "cover",
            }}
          />
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Repetra</h1>
            <p style={{ margin: "4px 0 0 0", opacity: 0.75 }}>Redefinir senha</p>
          </div>
        </div>

        {loading ? (
          <p style={{ margin: 0, opacity: 0.8 }}>Validando link...</p>
        ) : !validCode ? (
          <>
            <div
              style={{
                padding: 14,
                borderRadius: 14,
                background: "rgba(255, 80, 80, 0.12)",
                border: "1px solid rgba(255, 80, 80, 0.25)",
                color: "#ffb3b3",
                marginBottom: 16,
              }}
            >
              {error}
            </div>

            <button
              onClick={() => navigate("/")}
              style={buttonStyle}
            >
              Voltar para o app
            </button>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0, marginBottom: 16, opacity: 0.8 }}>
              Conta: <strong>{email}</strong>
            </p>

            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gap: 12 }}>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Nova senha"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={inputStyle}
                />

                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Confirmar nova senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={inputStyle}
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#aab4ff",
                    cursor: "pointer",
                    textAlign: "left",
                    padding: 0,
                    fontSize: 14,
                  }}
                >
                  {showPassword ? "Ocultar senha" : "Mostrar senha"}
                </button>

                {error ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      background: "rgba(255, 80, 80, 0.12)",
                      border: "1px solid rgba(255, 80, 80, 0.25)",
                      color: "#ffb3b3",
                    }}
                  >
                    {error}
                  </div>
                ) : null}

                {success ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      background: "rgba(80, 255, 140, 0.12)",
                      border: "1px solid rgba(80, 255, 140, 0.25)",
                      color: "#b8ffd0",
                    }}
                  >
                    {success}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  style={buttonStyle}
                >
                  {submitting ? "Salvando..." : "Salvar nova senha"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}