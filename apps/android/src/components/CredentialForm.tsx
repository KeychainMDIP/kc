import React, { useState, useEffect } from "react";
import {
    Box,
    TextField,
    FormHelperText,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    SelectChangeEvent,
} from "@mui/material";
import { useWalletContext } from "../contexts/WalletProvider";

interface CredentialsFormProps {
    schemaObject: any;
    baseCredential: string;
    onChange: (credentialString: string, isValid: boolean) => void;
}

const CredentialForm: React.FC<CredentialsFormProps> = ({
    schemaObject,
    baseCredential,
    onChange,
}) => {
    const { setError } = useWalletContext();
    const properties = schemaObject.properties;
    const requiredList: string[] = Array.isArray(schemaObject.required) ? schemaObject.required : [];

    const getTypes = (schema: any) => {
        let types: string[] = [];
        if (schema.type) {
            types = Array.isArray(schema.type) ? schema.type : [schema.type];
        } else if (schema.properties) {
            types = ["object"];
        }
        return types.filter((t) => t !== "null");
    };

    const initialValues: Record<string, any> = {};
    const initialTypes: Record<string, string> = {};

    const fieldEntries = Object.entries(properties).filter(
        ([name, schema]: [string, any]) => {
            const types = getTypes(schema);
            if (types.length > 1) {
                initialTypes[name] = types[0];
            }
            initialValues[name] = "";
            return types.length > 0;
        },
    );

    const fieldNames = fieldEntries.map(([name]) => name);
    const requiredFields = requiredList.filter((name) =>
        fieldNames.includes(name),
    );

    const [formValues, setFormValues] = useState<Record<string, any>>(initialValues);
    const [selectedTypes, setSelectedTypes] = useState<Record<string, string>>(initialTypes);
    const [errors, setErrors] = useState<Record<string, string>>({});

    function getType(schema: any) {
        let typeDef = schema.type;
        if (!typeDef && schema.properties) {
            typeDef = "object";
        }
        return typeDef;
    }

    const validateAll = (
        values: Record<string, any>,
        typesMap: Record<string, string>,
    ) => {
        const newErrors: Record<string, string> = {};
        fieldEntries.forEach(([name, schema]: [string, any]) => {
            const typeDef = getType(schema);
            const typeList = Array.isArray(typeDef)
                ? typeDef.filter((t) => t !== "null")
                : [typeDef];
            const currentType =
                typeList.length > 1 ? typesMap[name] : typeList[0];
            const value = values[name];
            const isRequired = requiredFields.includes(name);
            if (value === "" || value === undefined || value === null) {
                if (isRequired) {
                    newErrors[name] = "This field is required";
                }
            } else {
                switch (currentType) {
                case "string":
                    break;
                case "number":
                    if (isNaN(Number(value))) {
                        newErrors[name] = "Must be a number";
                    }
                    break;
                case "integer":
                    if (
                        isNaN(Number(value)) ||
                        !Number.isInteger(Number(value))
                    ) {
                        newErrors[name] = "Must be an integer";
                    }
                    break;
                case "boolean":
                    if (
                        !(
                            value === true ||
                            value === false ||
                            value === "true" ||
                            value === "false"
                        )
                    ) {
                        newErrors[name] = "Must be true or false";
                    }
                    break;
                case "array":
                    try {
                        const parsed = JSON.parse(value);
                        if (!Array.isArray(parsed)) {
                            newErrors[name] = "Must be a JSON array";
                        }
                    } catch {
                        newErrors[name] = "Invalid JSON";
                    }
                    break;
                case "object":
                    try {
                        const parsed = JSON.parse(value);
                        if (
                            typeof parsed !== "object" ||
                            parsed === null ||
                            Array.isArray(parsed)
                        ) {
                            newErrors[name] = "Must be a JSON object";
                        }
                    } catch {
                        newErrors[name] = "Invalid JSON";
                    }
                    break;
                default:
                    break;
                }
            }
        });
        return newErrors;
    };

    const buildCredentialJson = (
        values: Record<string, any>,
        typesMap: Record<string, string>,
    ) => {
        const formCredential: Record<string, any> = {};
        fieldEntries.forEach(([name, schema]: [string, any]) => {
            const value = values[name];
            if (value === "" || value === undefined || value === null) {
                return;
            }
            const typeDef = getType(schema);
            const typeList = Array.isArray(typeDef)
                ? typeDef.filter((t) => t !== "null")
                : [typeDef];
            const currentType =
                typeList.length > 1 ? typesMap[name] : typeList[0];
            switch (currentType) {
            case "string":
                formCredential[name] = String(value);
                break;
            case "number":
                formCredential[name] = Number(value);
                break;
            case "integer":
                formCredential[name] = parseInt(value, 10);
                break;
            case "boolean":
                formCredential[name] = value === "true" || value === true;
                break;
            case "array":
                try {
                    formCredential[name] = JSON.parse(value);
                } catch {
                    formCredential[name] = [];
                }
                break;
            case "object":
                try {
                    formCredential[name] = JSON.parse(value);
                } catch {
                    formCredential[name] = {};
                }
                break;
            default:
                formCredential[name] = value;
            }
        });

        let baseCredentialObj: any;
        try {
            baseCredentialObj = JSON.parse(baseCredential);
        } catch (e) {
            setError("Invalid base credential JSON");
            return "";
        }

        baseCredentialObj.credential = formCredential;
        return JSON.stringify(baseCredentialObj, null, 2);
    };

    const notifyParent = (
        vals: Record<string, any>,
        types: Record<string, string>,
    ) => {
        const newErrors = validateAll(vals, types);
        setErrors(newErrors);
        const isValid =
            Object.keys(newErrors).length === 0 &&
            requiredFields.every((field) => {
                const val = vals[field];
                return val !== "" && val !== undefined && val !== null;
            });

        if (isValid) {
            const credString = buildCredentialJson(vals, types);
            onChange(credString, true);
        }
    };

    const handleChangeInternal = (name: string, value: string) => {
        const updatedValues = { ...formValues, [name]: value };
        setFormValues(updatedValues);
        notifyParent(updatedValues, selectedTypes);
    };

    const handleValueChange = (
        name: string,
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
        handleChangeInternal(name, event.target.value);
    };

    const handleSelectChange = (name: string, event: SelectChangeEvent) => {
        handleChangeInternal(name, event.target.value);
    };

    const handleTypeChange = (name: string, event: SelectChangeEvent) => {
        const newType = event.target.value;
        const updatedTypes = { ...selectedTypes, [name]: newType };
        const updatedValues = { ...formValues, [name]: "" };
        setSelectedTypes(updatedTypes);
        setFormValues(updatedValues);
        notifyParent(updatedValues, updatedTypes);
    };

    useEffect(() => {
        notifyParent(formValues, selectedTypes);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [schemaObject]);

    function getFieldLabel(fieldName: string, fieldType: string) {
        return `${fieldName} (${fieldType})`;
    }

    return (
        <Box display="flex" flexDirection="column" sx={{ gap: 2 }}>
            {fieldEntries.map(([name, schema]: [string, any]) => {
                const typeDef = getType(schema);

                const typeList = Array.isArray(typeDef)
                    ? typeDef.filter((t) => t !== "null")
                    : [typeDef];
                const isMultiType = typeList.length > 1;
                const isRequired = requiredFields.includes(name);
                const value = formValues[name] ?? "";
                const errorMsg = errors[name] || "";

                if (isMultiType) {
                    const currentType =
                        selectedTypes[name] &&
                        Array.isArray(selectedTypes[name])
                            ? selectedTypes[name][0]
                            : selectedTypes[name] || typeList[0];
                    const isBooleanType = currentType === "boolean";
                    const isArrayType = currentType === "array";
                    const isObjectType = currentType === "object";
                    return (
                        <Box
                            key={name}
                            display="flex"
                            flexDirection="row"
                            sx={{ gap: 1 }}
                        >
                            <FormControl sx={{ width: "20%" }}>
                                <InputLabel id={`${name}-label`}>
                                    Type
                                </InputLabel>
                                <Select
                                    labelId={`${name}-label`}
                                    id={`${name}-select`}
                                    label="Type"
                                    value={currentType}
                                    onChange={(e) => handleTypeChange(name, e)}
                                    size="small"
                                >
                                    {typeList.map((t) => (
                                        <MenuItem key={t} value={t}>
                                            {t}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            {isBooleanType ? (
                                <FormControl
                                    required={isRequired}
                                    error={Boolean(errorMsg)}
                                    sx={{ width: "80%" }}
                                >
                                    <InputLabel id={`${name}-label`}>
                                        {getFieldLabel(name, currentType)}
                                    </InputLabel>

                                    <Select
                                        labelId={`${name}-label`}
                                        id={`${name}-select`}
                                        label={getFieldLabel(name, currentType)}
                                        value={value}
                                        onChange={(e) =>
                                            handleSelectChange(name, e)
                                        }
                                        size="small"
                                    >
                                        <MenuItem value="true">True</MenuItem>
                                        <MenuItem value="false">False</MenuItem>
                                    </Select>

                                    <FormHelperText>{errorMsg}</FormHelperText>
                                </FormControl>
                            ) : (
                                <TextField
                                    id={`${name}-textfield`}
                                    label={getFieldLabel(name, currentType)}
                                    required={isRequired}
                                    type={
                                        isArrayType || isObjectType
                                            ? "text"
                                            : currentType === "number" ||
                                                currentType === "integer"
                                                ? "number"
                                                : "text"
                                    }
                                    multiline={isArrayType || isObjectType}
                                    minRows={
                                        isArrayType || isObjectType
                                            ? 3
                                            : undefined
                                    }
                                    value={value}
                                    onChange={(e) => handleValueChange(name, e)}
                                    error={Boolean(errorMsg)}
                                    helperText={
                                        errorMsg ||
                                        (isArrayType
                                            ? "Enter a JSON array"
                                            : isObjectType
                                                ? "Enter a JSON object"
                                                : "")
                                    }
                                    sx={{ width: "80%" }}
                                    size="small"
                                />
                            )}
                        </Box>
                    );
                }

                const [singleType] = typeList;
                switch (singleType) {
                case "boolean":
                    return (
                        <FormControl
                            required={isRequired}
                            error={Boolean(errorMsg)}
                            key={name}
                        >
                            <InputLabel id={`${name}-label`}>
                                {getFieldLabel(name, singleType)}
                            </InputLabel>

                            <Select
                                labelId={`${name}-label`}
                                id={`${name}-select`}
                                label={getFieldLabel(name, singleType)}
                                value={value}
                                onChange={(e) =>
                                    handleSelectChange(name, e)
                                }
                                size="small"
                            >
                                <MenuItem value="true">True</MenuItem>
                                <MenuItem value="false">False</MenuItem>
                            </Select>

                            <FormHelperText>{errorMsg}</FormHelperText>
                        </FormControl>
                    );
                case "array":
                case "object":
                    return (
                        <TextField
                            id={`${name}-textfield`}
                            label={getFieldLabel(name, singleType)}
                            required={isRequired}
                            multiline
                            minRows={3}
                            value={value}
                            onChange={(e) => handleValueChange(name, e)}
                            error={Boolean(errorMsg)}
                            helperText={
                                errorMsg || `Enter a JSON ${typeList[0]}`
                            }
                            key={name}
                            size="small"
                        />
                    );
                case "number":
                case "integer":
                    return (
                        <TextField
                            id={`${name}-textfield`}
                            label={getFieldLabel(name, singleType)}
                            required={isRequired}
                            type="number"
                            slotProps={{
                                input: {
                                    inputProps: {
                                        step:
                                            typeList[0] === "integer"
                                                ? 1
                                                : undefined,
                                    },
                                },
                            }}
                            value={value}
                            onChange={(e) => handleValueChange(name, e)}
                            error={Boolean(errorMsg)}
                            helperText={errorMsg}
                            key={name}
                            size="small"
                        />
                    );
                default:
                    return (
                        <TextField
                            id={`${name}-textfield`}
                            label={getFieldLabel(name, singleType)}
                            required={isRequired}
                            value={value}
                            onChange={(e) => handleValueChange(name, e)}
                            error={Boolean(errorMsg)}
                            helperText={errorMsg}
                            key={name}
                            size="small"
                        />
                    );
                }
            })}
        </Box>
    );
};

export default CredentialForm;
