import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getPatcherDesktopInfo } from "./patcher-desktop";

export function usePasswordManagerNavigation() {
  const navigate = useNavigate();
  useEffect(
    () =>
      getPatcherDesktopInfo()?.passwordManager?.onOpen(() =>
        navigate("/password-manager"),
      ),
    [navigate],
  );
}
