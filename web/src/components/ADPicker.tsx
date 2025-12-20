import { useState, useEffect, useCallback } from "react";
import { Select, Space, Tag, Spin, Alert, Typography, Tabs, Avatar, Tooltip } from "antd";
import { UserOutlined, TeamOutlined, SearchOutlined, LoadingOutlined } from "@ant-design/icons";
import { api, ADUser, ADGroup, ADStatus } from "../api";

// Simple debounce implementation
function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

const { Text } = Typography;

export type ADSelection = {
  type: "User" | "Group";
  id: string;
  displayName: string;
  detail?: string; // email or description
};

type ADPickerProps = {
  value?: ADSelection[];
  onChange?: (selections: ADSelection[]) => void;
  mode?: "multiple" | "single";
  placeholder?: string;
  disabled?: boolean;
  allowedTypes?: ("User" | "Group")[];
};

export function ADPicker({
  value = [],
  onChange,
  mode = "multiple",
  placeholder = "Search for users or groups...",
  disabled = false,
  allowedTypes = ["User", "Group"],
}: ADPickerProps) {
  const [adStatus, setAdStatus] = useState<ADStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<ADUser[]>([]);
  const [groups, setGroups] = useState<ADGroup[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"User" | "Group">(
    allowedTypes.includes("User") ? "User" : "Group"
  );
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Check AD configuration status
  useEffect(() => {
    setStatusLoading(true);
    api.ad.getStatus()
      .then((status) => {
        console.log("ADPicker: AD status:", status);
        setAdStatus(status);
      })
      .catch((err) => {
        console.error("ADPicker: Failed to get AD status:", err);
        setAdStatus({ configured: false, enabled: false, auth_method: "none" });
      })
      .finally(() => setStatusLoading(false));
  }, []);

  // Debounced search function
  const performSearch = useCallback(
    debounce(async (query: string, type: "User" | "Group") => {
      console.log("ADPicker: Searching", type, "for:", query);
      if (!query || query.length < 2) {
        if (type === "User") setUsers([]);
        else setGroups([]);
        return;
      }

      setLoading(true);
      try {
        if (type === "User") {
          const result = await api.ad.searchUsers(query, 15);
          console.log("ADPicker: User results:", result);
          setUsers(result.users || []);
        } else {
          const result = await api.ad.searchGroups(query, 15);
          console.log("ADPicker: Group results:", result);
          setGroups(result.groups || []);
        }
      } catch (err) {
        console.error("ADPicker: Search failed:", err);
      } finally {
        setLoading(false);
      }
    }, 300),
    []
  );

  // Trigger search when query or tab changes
  useEffect(() => {
    if (dropdownOpen) {
      performSearch(searchQuery, activeTab);
    }
  }, [searchQuery, activeTab, dropdownOpen, performSearch]);

  if (statusLoading) {
    return <Spin size="small" />;
  }

  if (!adStatus?.configured) {
    return (
      <Alert
        type="info"
        message="Active Directory not configured"
        description="Configure Active Directory in Settings to search users and groups."
        showIcon
      />
    );
  }

  const handleSearch = (value: string) => {
    console.log("ADPicker: handleSearch:", value);
    setSearchQuery(value);
  };

  const handleChange = (selectedValue: string | string[] | null) => {
    console.log("ADPicker: handleChange:", selectedValue);
    if (!onChange) return;

    if (selectedValue === null || selectedValue === undefined) {
      onChange([]);
      return;
    }

    // For single mode
    if (mode === "single") {
      if (typeof selectedValue === "string" && selectedValue) {
        // Parse the value to find the corresponding user or group
        const [type, ...idParts] = selectedValue.split(":");
        const id = idParts.join(":");

        if (type === "User") {
          const user = users.find((u) => u.dn === id);
          if (user) {
            onChange([{
              type: "User",
              id: user.sAMAccountName,
              displayName: user.displayName || user.sAMAccountName,
              detail: user.mail,
            }]);
          }
        } else if (type === "Group") {
          const group = groups.find((g) => g.dn === id);
          if (group) {
            onChange([{
              type: "Group",
              id: group.cn,
              displayName: group.displayName || group.cn,
              detail: group.description,
            }]);
          }
        }
      }
      return;
    }

    // For multiple mode
    if (Array.isArray(selectedValue)) {
      const selections: ADSelection[] = selectedValue.map((val) => {
        const [type, ...idParts] = val.split(":");
        const id = idParts.join(":");

        if (type === "User") {
          const user = users.find((u) => u.dn === id);
          if (user) {
            return {
              type: "User" as const,
              id: user.sAMAccountName,
              displayName: user.displayName || user.sAMAccountName,
              detail: user.mail,
            };
          }
        } else {
          const group = groups.find((g) => g.dn === id);
          if (group) {
            return {
              type: "Group" as const,
              id: group.cn,
              displayName: group.displayName || group.cn,
              detail: group.description,
            };
          }
        }
        // Return placeholder if not found
        return {
          type: type as "User" | "Group",
          id,
          displayName: id,
        };
      });
      onChange(selections);
    }
  };

  const currentValue = mode === "multiple"
    ? value.map((v) => `${v.type}:${v.id}`)
    : value.length > 0 ? `${value[0].type}:${value[0].id}` : undefined;

  // Build options from current search results
  const userOptions = allowedTypes.includes("User")
    ? users.map((user) => ({
        value: `User:${user.dn}`,
        label: (
          <Space>
            <Avatar size="small" icon={<UserOutlined />} style={{ backgroundColor: "#1890ff" }} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <Text strong>{user.displayName || user.sAMAccountName}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {user.mail || user.userPrincipalName}
              </Text>
            </div>
          </Space>
        ),
      }))
    : [];

  const groupOptions = allowedTypes.includes("Group")
    ? groups.map((group) => ({
        value: `Group:${group.dn}`,
        label: (
          <Space>
            <Avatar size="small" icon={<TeamOutlined />} style={{ backgroundColor: "#52c41a" }} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <Text strong>{group.displayName || group.cn}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {group.description || "Group"}
              </Text>
            </div>
          </Space>
        ),
      }))
    : [];

  const options = activeTab === "User" ? userOptions : groupOptions;

  return (
    <div>
      {allowedTypes.length > 1 && (
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as "User" | "Group")}
          size="small"
          style={{ marginBottom: 8 }}
          items={[
            ...(allowedTypes.includes("User") ? [{
              key: "User",
              label: (
                <Space>
                  <UserOutlined />
                  Users
                </Space>
              ),
            }] : []),
            ...(allowedTypes.includes("Group") ? [{
              key: "Group",
              label: (
                <Space>
                  <TeamOutlined />
                  Groups
                </Space>
              ),
            }] : []),
          ]}
        />
      )}

      <Select
        mode={mode === "multiple" ? "multiple" : undefined}
        showSearch
        allowClear
        placeholder={placeholder}
        disabled={disabled}
        value={currentValue}
        onChange={handleChange}
        onSearch={handleSearch}
        onDropdownVisibleChange={(open) => {
          setDropdownOpen(open);
          if (open && searchQuery) {
            performSearch(searchQuery, activeTab);
          }
        }}
        filterOption={false}
        notFoundContent={
          loading ? (
            <Space>
              <LoadingOutlined />
              <span>Searching...</span>
            </Space>
          ) : searchQuery.length < 2 ? (
            <Text type="secondary">Type at least 2 characters to search</Text>
          ) : (
            <Text type="secondary">No {activeTab.toLowerCase()}s found</Text>
          )
        }
        options={options}
        style={{ width: "100%" }}
        dropdownStyle={{ minWidth: 350 }}
        labelInValue={false}
        suffixIcon={<SearchOutlined />}
      />

      {value.length > 0 && mode === "single" && (
        <div style={{ marginTop: 8 }}>
          <Tag
            color={value[0].type === "User" ? "blue" : "green"}
            icon={value[0].type === "User" ? <UserOutlined /> : <TeamOutlined />}
          >
            {value[0].displayName}
            {value[0].detail && (
              <Tooltip title={value[0].detail}>
                <Text type="secondary" style={{ marginLeft: 4, fontSize: 11 }}>
                  ({value[0].type})
                </Text>
              </Tooltip>
            )}
          </Tag>
        </div>
      )}
    </div>
  );
}

export default ADPicker;






