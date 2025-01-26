import base58

def solana_private_key_to_decimal_list(private_key):
    """
    Converts a Solana Base58-encoded private key into a comma-separated numerical format.

    :param private_key: The private key as a Base58 string.
    :return: Comma-separated numerical string representation of the private key.
    """
    # Decode the Base58 string into bytes
    try:
        private_key_bytes = base58.b58decode(private_key)
    except ValueError:
        raise ValueError("Invalid Base58 private key format.")

    # Ensure the length is valid for Solana (32 or 64 bytes)
    if len(private_key_bytes) not in (32, 64):
        raise ValueError(f"Decoded private key length is invalid: {len(private_key_bytes)} bytes. Expected 32 or 64.")

    # Convert bytes to a list of decimal values
    decimal_values = [byte for byte in private_key_bytes]

    # Join the decimal values into a comma-separated string
    formatted_key = ",".join(map(str, decimal_values))
    return formatted_key

# Example usage
# Replace with your Base58-encoded private key
private_key_base58 = "aQ7qD4UArVn6yuHHmhuWLnW96uu3jMhWyKYKd8qqrnxD4yCWxPSDG8qnQ51WuQv5KCHDh3WkuhTeiZdMFyrjjUm"
private_key_decimal_list = solana_private_key_to_decimal_list(private_key_base58)
print(private_key_decimal_list)
