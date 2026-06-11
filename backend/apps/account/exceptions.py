from app.exceptions import AuthenticationError


class WrongCurrentPassword(AuthenticationError):
    code = "wrong_current_password"
    message = "Current password is incorrect."
