"""Account app constants.

The account app has NO model of its own — it operates on the `user` app's User
(self-service profile + password). This is intentional reuse, not duplication.
"""
ACCOUNT_TAG = "account"
