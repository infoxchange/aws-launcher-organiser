import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import type React from "react";
import { useRef, useState } from "react";
import type { SortConfig } from "../utils/configStore";
import "./SortingSettings.css";

export interface SortingSettingsProps {
  sortBy: SortConfig[];
  onSortByChange: (sortBy: SortConfig[]) => void;
  matcherError: string | null;
  onMatcherErrorChange: (error: string | null) => void;
  onValidateMatcher: (matcher: string) => boolean;
}

export const SortingSettings: React.FC<SortingSettingsProps> = ({
  sortBy,
  onSortByChange,
  matcherError,
  onMatcherErrorChange,
  onValidateMatcher,
}) => {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingConfig, setEditingConfig] = useState<SortConfig>({
    type: "nameSubstring",
    direction: "asc",
    matcher: "",
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleAddSortConfig = () => {
    if (editingConfig.type === "nameSubstring" && !editingConfig.matcher) return;
    if (
      editingConfig.type === "nameSubstring" &&
      editingConfig.matcher &&
      !onValidateMatcher(editingConfig.matcher)
    )
      return;
    const newSortBy = [...sortBy, editingConfig];
    onSortByChange(newSortBy);
    setEditingConfig({ type: "nameSubstring", direction: "asc", matcher: "" });
    onMatcherErrorChange(null);
    setShowAddForm(false);
  };

  const handleSaveSortConfig = (index: number) => {
    if (editingConfig.type === "nameSubstring" && !editingConfig.matcher) return;
    if (
      editingConfig.type === "nameSubstring" &&
      editingConfig.matcher &&
      !onValidateMatcher(editingConfig.matcher)
    )
      return;
    const newSortBy = [...sortBy];
    newSortBy[index] = editingConfig;
    onSortByChange(newSortBy);
    setEditingIndex(null);
    setEditingConfig({ type: "nameSubstring", direction: "asc", matcher: "" });
    onMatcherErrorChange(null);
  };

  const handleDeleteSortConfig = (index: number) => {
    const newSortBy = sortBy.filter((_, i) => i !== index);
    onSortByChange(newSortBy);
    setEditingIndex(null);
  };

  const handleEditSortConfig = (index: number) => {
    setEditingIndex(index);
    setEditingConfig(sortBy[index]);
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditingConfig({ type: "nameSubstring", direction: "asc", matcher: "" });
    onMatcherErrorChange(null);
  };

  const handleAddCancel = () => {
    setShowAddForm(false);
    setEditingConfig({ type: "nameSubstring", direction: "asc", matcher: "" });
    onMatcherErrorChange(null);
  };

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (index: number) => {
    const from = dragIndexRef.current;
    if (from === null || from === index) {
      dragIndexRef.current = null;
      setDragOverIndex(null);
      return;
    }
    const reordered = [...sortBy];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(index, 0, moved);
    onSortByChange(reordered);
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  return (
    <div className="sorting-settings">
      <section className="sorting-section">
        <h4 className="section-heading">Account Sorting</h4>
        <ol className="sort-list">
          {sortBy.length === 0 ? (
            <li className="empty-message">No sorting rules configured</li>
          ) : (
            sortBy.map((config, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: items don't have stable IDs and key is used with drag-drop reordering
                key={index}
                className={`sort-item${dragOverIndex === index ? " drag-over" : ""}`}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
              >
                {editingIndex === index ? (
                  <div className="sort-edit-form">
                    <div className="form-column">
                      <div className="form-group">
                        <label htmlFor={`sort-type-${index}`}>Type</label>
                        <Dropdown
                          id={`sort-type-${index}`}
                          value={editingConfig.type}
                          options={[
                            { label: "Name Substring", value: "nameSubstring" },
                            { label: "Tags", value: "tags" },
                          ]}
                          onChange={(e) => setEditingConfig({ ...editingConfig, type: e.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label htmlFor={`sort-direction-${index}`}>Direction</label>
                        <Dropdown
                          id={`sort-direction-${index}`}
                          value={editingConfig.direction}
                          options={[
                            { label: "Ascending", value: "asc" },
                            { label: "Descending", value: "desc" },
                          ]}
                          onChange={(e) =>
                            setEditingConfig({ ...editingConfig, direction: e.value })
                          }
                        />
                      </div>
                      {editingConfig.type === "nameSubstring" && (
                        <div className="form-group">
                          <label htmlFor={`sort-matcher-${index}`}>Regex Matcher</label>
                          <InputText
                            id={`sort-matcher-${index}`}
                            value={editingConfig.matcher || ""}
                            onChange={(e) => {
                              const value = e.target.value || "";
                              setEditingConfig({ ...editingConfig, matcher: value });
                              if (value) {
                                onValidateMatcher(value);
                              } else {
                                onMatcherErrorChange(null);
                              }
                            }}
                            placeholder="e.g., prod-(.*)"
                            className={matcherError ? "p-invalid" : ""}
                          />
                          {matcherError && <small className="matcher-error">{matcherError}</small>}
                        </div>
                      )}
                    </div>
                    <div className="sort-edit-buttons">
                      <Button
                        label="Save"
                        size="small"
                        onClick={() => handleSaveSortConfig(index)}
                        disabled={matcherError !== null}
                      />
                      <Button label="Cancel" size="small" outlined onClick={handleCancel} />
                    </div>
                  </div>
                ) : (
                  <div className="sort-display">
                    <button
                      type="button"
                      className="drag-handle"
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      title="Drag to reorder"
                    >
                      <i className="pi pi-bars" />
                    </button>
                    <div className="sort-info">
                      <div className="sort-type">
                        {config.type === "nameSubstring" ? "Name Substring" : "Tags"}
                      </div>
                      <div className="sort-details">
                        {config.type === "nameSubstring" ? (
                          <>
                            <span className="detail-label">Matcher:</span>
                            <span className="detail-value">{config.matcher}</span>
                          </>
                        ) : null}
                        <span className="detail-label">Direction:</span>
                        <span className="detail-value">{config.direction}</span>
                      </div>
                    </div>
                    <div className="sort-actions">
                      <Button
                        icon="pi pi-pencil"
                        rounded
                        text
                        size="small"
                        onClick={() => handleEditSortConfig(index)}
                      />
                      <Button
                        icon="pi pi-trash"
                        rounded
                        text
                        severity="danger"
                        size="small"
                        onClick={() => handleDeleteSortConfig(index)}
                      />
                    </div>
                  </div>
                )}
              </li>
            ))
          )}
        </ol>

        {!showAddForm && (
          <Button
            label="Add Sort Rule"
            icon="pi pi-plus"
            onClick={() => setShowAddForm(true)}
            className="add-sort-button"
          />
        )}

        {showAddForm && (
          <div className="add-sort-section">
            <h5>Add Sort Rule</h5>
            <div className="form-column">
              <div className="form-group">
                <label htmlFor="new-sort-type">Type</label>
                <Dropdown
                  id="new-sort-type"
                  value={editingConfig.type}
                  options={[
                    { label: "Name Substring", value: "nameSubstring" },
                    { label: "Tags", value: "tags" },
                  ]}
                  onChange={(e) => setEditingConfig({ ...editingConfig, type: e.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-sort-direction">Direction</label>
                <Dropdown
                  id="new-sort-direction"
                  value={editingConfig.direction}
                  options={[
                    { label: "Ascending", value: "asc" },
                    { label: "Descending", value: "desc" },
                  ]}
                  onChange={(e) => setEditingConfig({ ...editingConfig, direction: e.value })}
                />
              </div>
              {editingConfig.type === "nameSubstring" && (
                <div className="form-group">
                  <label htmlFor="new-sort-matcher">Regex Matcher</label>
                  <InputText
                    id="new-sort-matcher"
                    value={editingConfig.matcher || ""}
                    onChange={(e) => {
                      const value = e.target.value || "";
                      setEditingConfig({ ...editingConfig, matcher: value });
                      if (value) {
                        onValidateMatcher(value);
                      } else {
                        onMatcherErrorChange(null);
                      }
                    }}
                    placeholder="e.g., prod-(.*)"
                    className={matcherError ? "p-invalid" : ""}
                  />
                  {matcherError && <small className="matcher-error">{matcherError}</small>}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Button
                label="Add Rule"
                onClick={handleAddSortConfig}
                disabled={
                  editingConfig.type === "nameSubstring" &&
                  (!editingConfig.matcher || matcherError !== null)
                }
                icon="pi pi-plus"
              />
              <Button label="Cancel" outlined onClick={handleAddCancel} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
