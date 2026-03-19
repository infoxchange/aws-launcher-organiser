import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";
import type React from "react";
import { useState } from "react";
import { RemoteConfigSchema, useConfigStore } from "../utils/configStore";
import "./SettingsDialog.css";

export interface SettingsDialogProps {
  visible: boolean;
  onHide: () => void;
  jsonConfig: string;
  onConfigChange: (config: string) => void;
  configError: string | null;
  onConfigError: (error: string | null) => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  visible,
  onHide,
  jsonConfig,
  onConfigChange,
  configError,
  onConfigError,
}) => {
  const {
    groups,
    setGroups,
    autoUpdateEnabled,
    autoUpdateUrl,
    autoUpdateAuthToken,
    setAutoUpdateEnabled,
    setAutoUpdateUrl,
    setAutoUpdateAuthToken,
  } = useConfigStore();

  const [testStatus, setTestStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const runConnectionTest = async () => {
    if (!autoUpdateUrl) return;
    setTestStatus("loading");
    setTestMessage(null);
    try {
      const headers: Record<string, string> = {};
      if (autoUpdateAuthToken) headers.Authorization = `Bearer ${autoUpdateAuthToken}`;
      const response = await fetch(autoUpdateUrl, { headers });
      if (!response.ok) {
        setTestStatus("error");
        setTestMessage(`HTTP ${response.status}: ${response.statusText}`);
        return;
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        setTestStatus("error");
        setTestMessage("Response is not valid JSON.");
        return;
      }
      const result = RemoteConfigSchema.safeParse(json);
      if (!result.success) {
        setTestStatus("error");
        setTestMessage(
          `Schema validation failed: ${result.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ")}`
        );
        return;
      }
      setTestStatus("success");
      setTestMessage(
        `Config updated — ${result.data.groups.length} top-level group(s), version ${result.data.version}.`
      );
      setGroups(result.data.groups);
      onConfigChange(JSON.stringify(result.data.groups, null, 2));
    } catch (err) {
      setTestStatus("error");
      setTestMessage(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Dialog header="Settings" visible={visible} onHide={onHide} modal style={{ width: "50vw" }}>
      <div className="settings-dialog">
        <div className="settings-content">
          <section className="auto-update-section">
            <h4 className="section-heading">Auto Update</h4>
            <div className="auto-update-toggle-row">
              <label htmlFor="auto-update-toggle">Enable auto update</label>
              <InputSwitch
                inputId="auto-update-toggle"
                checked={autoUpdateEnabled}
                onChange={(e) => setAutoUpdateEnabled(e.value ?? false)}
              />
            </div>
            {autoUpdateEnabled && (
              <>
                <Message
                  severity="info"
                  className="auto-update-note"
                  text="Edit mode is hidden while auto update is enabled. Manage your group config via the remote URL below."
                />
                <div className="field">
                  <label htmlFor="auto-update-url">Config URL</label>
                  <div className="url-input-row">
                    <InputText
                      id="auto-update-url"
                      value={autoUpdateUrl}
                      onChange={(e) => {
                        setAutoUpdateUrl(e.target.value);
                        setTestStatus("idle");
                        setTestMessage(null);
                      }}
                      placeholder="https://example.com/config.json"
                      className="url-input"
                    />
                    <Button
                      label="Test"
                      icon={testStatus === "loading" ? "pi pi-spin pi-spinner" : "pi pi-bolt"}
                      outlined
                      disabled={!autoUpdateUrl || testStatus === "loading"}
                      onClick={runConnectionTest}
                    />
                  </div>
                  {testStatus !== "idle" && (
                    <Message
                      severity={
                        testStatus === "success"
                          ? "success"
                          : testStatus === "error"
                            ? "error"
                            : "info"
                      }
                      text={testMessage ?? ""}
                      className="test-result-message"
                    />
                  )}
                </div>
                <div className="field">
                  <label htmlFor="auto-update-token">Auth Token (optional)</label>
                  <Password
                    inputId="auto-update-token"
                    value={autoUpdateAuthToken}
                    onChange={(e) => setAutoUpdateAuthToken(e.target.value)}
                    feedback={false}
                    toggleMask
                    placeholder="Bearer token"
                    className="w-full"
                    inputClassName="w-full"
                  />
                </div>
              </>
            )}
          </section>

          <hr className="section-divider" />

          <label htmlFor="json-config">Configuration (JSON)</label>
          <textarea
            id="json-config"
            value={jsonConfig}
            onChange={(e) => {
              onConfigChange(e.target.value);
              onConfigError(null);
            }}
            className="json-textarea"
            readOnly={autoUpdateEnabled}
          />
          {configError && <div className="config-error">{configError}</div>}
          <div className="dialog-buttons">
            <Button
              label="Save"
              onClick={() => {
                try {
                  const parsed = JSON.parse(jsonConfig);
                  setGroups(parsed);
                  onHide();
                  onConfigError(null);
                } catch (e) {
                  onConfigError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
              className="save-button"
            />
            <Button
              label="Reset to Defaults"
              outlined
              onClick={() => {
                const { resetToDefaults } = useConfigStore.getState();
                resetToDefaults();
                onConfigChange(JSON.stringify(useConfigStore.getState().groups, null, 2));
                onConfigError(null);
              }}
            />
            <Button
              label="Cancel"
              outlined
              onClick={() => {
                onHide();
                onConfigChange(JSON.stringify(groups, null, 2));
                onConfigError(null);
              }}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
};
