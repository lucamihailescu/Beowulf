from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CheckRequest(_message.Message):
    __slots__ = ("application_id", "principal", "action", "resource", "context")
    class ContextEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: Value
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[Value, _Mapping]] = ...) -> None: ...
    APPLICATION_ID_FIELD_NUMBER: _ClassVar[int]
    PRINCIPAL_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_FIELD_NUMBER: _ClassVar[int]
    application_id: str
    principal: Entity
    action: Entity
    resource: Entity
    context: _containers.MessageMap[str, Value]
    def __init__(self, application_id: _Optional[str] = ..., principal: _Optional[_Union[Entity, _Mapping]] = ..., action: _Optional[_Union[Entity, _Mapping]] = ..., resource: _Optional[_Union[Entity, _Mapping]] = ..., context: _Optional[_Mapping[str, Value]] = ...) -> None: ...

class CheckResponse(_message.Message):
    __slots__ = ("allowed", "reasons", "errors")
    ALLOWED_FIELD_NUMBER: _ClassVar[int]
    REASONS_FIELD_NUMBER: _ClassVar[int]
    ERRORS_FIELD_NUMBER: _ClassVar[int]
    allowed: bool
    reasons: _containers.RepeatedScalarFieldContainer[str]
    errors: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, allowed: bool = ..., reasons: _Optional[_Iterable[str]] = ..., errors: _Optional[_Iterable[str]] = ...) -> None: ...

class BatchCheckRequest(_message.Message):
    __slots__ = ("checks",)
    CHECKS_FIELD_NUMBER: _ClassVar[int]
    checks: _containers.RepeatedCompositeFieldContainer[CheckRequest]
    def __init__(self, checks: _Optional[_Iterable[_Union[CheckRequest, _Mapping]]] = ...) -> None: ...

class BatchCheckResponse(_message.Message):
    __slots__ = ("results",)
    RESULTS_FIELD_NUMBER: _ClassVar[int]
    results: _containers.RepeatedCompositeFieldContainer[CheckResponse]
    def __init__(self, results: _Optional[_Iterable[_Union[CheckResponse, _Mapping]]] = ...) -> None: ...

class LookupResourcesRequest(_message.Message):
    __slots__ = ("application_id", "principal", "action", "resource_type", "context")
    class ContextEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: Value
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[Value, _Mapping]] = ...) -> None: ...
    APPLICATION_ID_FIELD_NUMBER: _ClassVar[int]
    PRINCIPAL_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_FIELD_NUMBER: _ClassVar[int]
    application_id: str
    principal: Entity
    action: Entity
    resource_type: str
    context: _containers.MessageMap[str, Value]
    def __init__(self, application_id: _Optional[str] = ..., principal: _Optional[_Union[Entity, _Mapping]] = ..., action: _Optional[_Union[Entity, _Mapping]] = ..., resource_type: _Optional[str] = ..., context: _Optional[_Mapping[str, Value]] = ...) -> None: ...

class LookupResourcesResponse(_message.Message):
    __slots__ = ("resource_ids",)
    RESOURCE_IDS_FIELD_NUMBER: _ClassVar[int]
    resource_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, resource_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class Entity(_message.Message):
    __slots__ = ("type", "id")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    type: str
    id: str
    def __init__(self, type: _Optional[str] = ..., id: _Optional[str] = ...) -> None: ...

class Value(_message.Message):
    __slots__ = ("string_value", "int_value", "bool_value")
    STRING_VALUE_FIELD_NUMBER: _ClassVar[int]
    INT_VALUE_FIELD_NUMBER: _ClassVar[int]
    BOOL_VALUE_FIELD_NUMBER: _ClassVar[int]
    string_value: str
    int_value: int
    bool_value: bool
    def __init__(self, string_value: _Optional[str] = ..., int_value: _Optional[int] = ..., bool_value: bool = ...) -> None: ...
