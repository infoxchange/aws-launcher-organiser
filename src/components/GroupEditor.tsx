import { Button } from "primereact/button";
import type React from "react";
import { useState } from "react";
import type { Group } from "../utils/configStore";
import "./GroupEditor.css";

export interface GroupEditorProps {
  group: Group;
  onSave: (updatedGroup: Group) => void;
  onAddChild: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

export const GroupEditor: React.FC<GroupEditorProps> = ({
  group,
  onSave,
  onAddChild,
  onDelete,
  onCancel,
}) => {
  const [editedGroup, setEditedGroup] = useState<Group>(group);

  const handleSave = () => {
    onSave(editedGroup);
  };

  const handleChange = <K extends keyof Group>(field: K, value: Group[K]) => {
    setEditedGroup((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleMatcherChange = (value: string | string[]) => {
    handleChange("matcher", value);
  };

  return (
    <div className="group-editor">
      <div className="group-editor-field">
        <label htmlFor={`name-${group.key}`}>Name</label>
        <input
          id={`name-${group.key}`}
          type="text"
          value={editedGroup.name}
          onChange={(e) => handleChange("name", e.target.value)}
          placeholder="Group name"
        />
      </div>

      <div className="group-editor-field">
        <label htmlFor={`icon-${group.key}`}>Icon URL</label>
        <input
          id={`icon-${group.key}`}
          type="text"
          value={editedGroup.icon || ""}
          onChange={(e) => handleChange("icon", e.target.value || undefined)}
          placeholder="https://example.com/icon.png"
        />
      </div>

      <div className="group-editor-field">
        <label htmlFor={`matcher-${group.key}`}>Matcher (Regex)</label>
        <textarea
          id={`matcher-${group.key}`}
          value={
            Array.isArray(editedGroup.matcher)
              ? editedGroup.matcher.join("\n")
              : editedGroup.matcher || ""
          }
          onChange={(e) => {
            const value = e.target.value.trim();
            if (value.includes("\n")) {
              handleMatcherChange(value.split("\n").filter((line) => line.trim()));
            } else {
              handleMatcherChange(value);
            }
          }}
          placeholder="account-prod&#10;account-staging"
        />
      </div>

      <div className="group-editor-checkbox">
        <input
          type="checkbox"
          id={`expanded-${group.key}`}
          checked={editedGroup.expandedByDefault || false}
          onChange={(e) => handleChange("expandedByDefault", e.target.checked)}
        />
        <label htmlFor={`expanded-${group.key}`}>Expanded by default</label>
      </div>

      <div className="group-editor-field">
        <label htmlFor={`description-${group.key}`}>Description</label>
        <textarea
          id={`description-${group.key}`}
          value={editedGroup.description || ""}
          onChange={(e) => handleChange("description", e.target.value || undefined)}
          placeholder="Optional description"
        />
      </div>

      <div className="group-editor-actions">
        <Button
          label="Save"
          icon="pi pi-check"
          onClick={handleSave}
          severity="success"
          size="small"
        />
        <Button label="Add Child Group" icon="pi pi-plus" onClick={onAddChild} size="small" />
        <Button
          label="Delete"
          icon="pi pi-trash"
          onClick={onDelete}
          severity="danger"
          size="small"
        />
        <Button label="Cancel" icon="pi pi-times" onClick={onCancel} text size="small" />
      </div>
    </div>
  );
};
